import type { Browser } from "playwright-core";
import { Prisma } from "@/app/generated/prisma/client";
import {
  PriceCheckFailureCode,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  scrapeAmazonPrice,
  type ScrapedAmazonPrice,
} from "@/lib/amazon-scraper";
import {
  getBrowserLaunchUserMessage,
  launchScraperBrowser,
} from "@/lib/scraper-browser";
import { calculateSellPrice } from "@/lib/variant-pricing";
import { buildReviseInventoryStatusXML } from "@/lib/ebay-xml";
import { callEbayReviseInventoryStatus, getStoreNumber } from "@/lib/ebay";
import { logger } from "@/lib/logger";
import { invalidatePriceCaches } from "@/lib/cache-tags";
import {
  getAmazonPriceTrackingLabel,
  getAmazonPriceUnavailableMessage,
  normalizeAmazonPriceTrackingMode,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { getPriceCheckPrerequisiteIssue } from "@/lib/price-check-eligibility";
import {
  getPriceCheckFailureCode,
  getPriceCheckProductOutcomeForFailure,
  type PriceCheckProductOutcome,
} from "@/lib/price-check-failures";
import { getLowStockResolvedUpdate } from "@/lib/low-stock-products";
import { shouldAutomaticallyApplyPriceIncrease } from "@/lib/price-change-automation";
import {
  extractVariantSelectionHints,
  type VariantSelectionHints,
} from "@/lib/amazon-variant-selection";
import {
  PriceCheckTimingRecorder,
  resolvePriceCheckOptimizationConfig,
  type PriceCheckOptimizationConfig,
} from "@/lib/price-check-optimizations";
import { reportCompletedProductCallbacks } from "@/lib/price-check-progress";
import {
  createAmazonDeliveryStateSession,
  resetAmazonDeliveryState,
} from "@/lib/amazon-delivery-state";

const PRICE_TOLERANCE = 0.01;
const MIN_SAFE_PRODUCT_DELAY_MS = 1000;
const DEFAULT_PRODUCT_DELAY_MIN_MS = 3000;
const DEFAULT_PRODUCT_DELAY_MAX_MS = 7000;
const PRODUCT_DELAY_MIN_MS = Math.max(
  MIN_SAFE_PRODUCT_DELAY_MS,
  readDelayMs(
    "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS",
    DEFAULT_PRODUCT_DELAY_MIN_MS
  )
);
const PRODUCT_DELAY_MAX_MS = Math.max(
  PRODUCT_DELAY_MIN_MS,
  readDelayMs(
    "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS",
    DEFAULT_PRODUCT_DELAY_MAX_MS
  )
);
const DEFAULT_PRODUCT_CHECK_TIMEOUT_MS = 120_000;
const PRODUCT_CHECK_TIMEOUT_MS = Math.max(
  15_000,
  readDelayMs(
    "LISTFLOW_PRICE_CHECK_PRODUCT_TIMEOUT_MS",
    DEFAULT_PRODUCT_CHECK_TIMEOUT_MS
  )
);
const SUPPLIER_NAME = "Amazon AU";

export interface PriceCheckResult {
  checked: number;
  changed: number;
  pendingReview: number;
  failed: number;
  skipped: number;
  unchanged: number;
  fresh: number;
  unavailable: number;
  technicalErrors: number;
  needsVerification: number;
  listingUpdateFailures: number;
  retryAttempts: number;
  classificationAvailable: boolean;
  reason?: string;
  cancelled?: boolean;
}

export type PriceCheckProgress = PriceCheckResult & { total: number };

export type PriceCheckProductFailure = {
  productId: string;
  code: PriceCheckFailureCode;
  message: string;
  checkedAt: Date;
};

export type PriceCheckProductCompletion = {
  productId: string;
  productAsin: string | null;
  productTitle: string | null;
  outcome: PriceCheckProductOutcome;
  failureCode: PriceCheckFailureCode | null;
  message: string | null;
  listingUpdateFailed: boolean;
  retryAttempts: number;
  durationMs: number | null;
  checkedAt: Date | null;
};

interface RunPriceCheckOptions {
  jobId?: string;
  optimizationConfig?: PriceCheckOptimizationConfig;
  completionIncludesProgress?: boolean;
  storeId?: string;
  productIds?: string[];
  ignoreSchedule?: boolean;
  simulatedPrices?: Record<string, number>;
  onProgress?: (progress: PriceCheckProgress) => void | Promise<void>;
  onProductComplete?: (
    productId: string,
    progress: PriceCheckProgress,
    completion: PriceCheckProductCompletion,
  ) => void | Promise<void>;
  onProductFailure?: (
    failure: PriceCheckProductFailure,
  ) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
}

type ProductRecord = NonNullable<Awaited<ReturnType<typeof prisma.product.findFirst>>>;
type StoreRecord = NonNullable<Awaited<ReturnType<typeof prisma.store.findFirst>>>;
type RevisableProduct = ProductRecord & { store: StoreRecord };
type CalculatedVariantPrice = {
  id: string;
  previousBuyPrice: number;
  nextBuyPrice: number;
  previousSellPrice: number;
  nextSellPrice: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toMoneyDecimal(value: number) {
  return new Prisma.Decimal(roundMoney(value).toFixed(2));
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(numeric) ? numeric : null;
}

function hasMoneyChanged(previous: number, next: number) {
  return Math.abs(previous - next) > PRICE_TOLERANCE;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDelayMs(envName: string, fallback: number) {
  const raw = process.env[envName];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function getProductDelayMs() {
  return (
    PRODUCT_DELAY_MIN_MS +
    Math.random() * (PRODUCT_DELAY_MAX_MS - PRODUCT_DELAY_MIN_MS)
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function getSupplierSettings(storeId?: string) {
  if (storeId) {
    const settings = await prisma.supplierSettings.findUnique({
      where: {
        storeId_supplierName: {
          storeId,
          supplierName: SUPPLIER_NAME,
        },
      },
    });

    if (settings) {
      return settings;
    }

    return prisma.supplierSettings.create({
      data: { storeId, supplierName: SUPPLIER_NAME },
    });
  }

  const globalSettings = await prisma.supplierSettings.findFirst({
    where: { storeId: null, supplierName: SUPPLIER_NAME },
  });

  return (
    globalSettings ??
    prisma.supplierSettings.create({
      data: { supplierName: SUPPLIER_NAME },
    })
  );
}

export async function reviseProductPrice(
  product: RevisableProduct,
  overrideStartPrice?: number,
) {
  if (!product.ebayItemId) {
    throw new Error("Product is missing an eBay item ID.");
  }

  const storeNumber = await getStoreNumber(product.storeId);
  const startPrice = overrideStartPrice ?? decimalToNumber(product.price);

  if (startPrice === null) {
    throw new Error("Product is missing a valid eBay price.");
  }

  const xml = buildReviseInventoryStatusXML(product.ebayItemId, { startPrice });

  return callEbayReviseInventoryStatus(xml, storeNumber);
}

async function automaticallyApplyPriceIncrease(input: {
  product: RevisableProduct;
  variants: CalculatedVariantPrice[];
  nextPrimarySellPrice: number;
  checkedAt: Date;
  recordTiming?: (stage: string, durationMs: number) => void;
}) {
  let reviseResult: Awaited<ReturnType<typeof reviseProductPrice>>;
  const measure = async <T>(stage: string, operation: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      input.recordTiming?.(stage, Date.now() - startedAt);
    }
  };

  try {
    reviseResult = await measure("ebay-update", () =>
      reviseProductPrice(
        input.product,
        input.nextPrimarySellPrice,
      ),
    );
  } catch (error) {
    reviseResult = {
      success: false,
      errorMessage: getErrorMessage(error),
    };
  }

  if (!reviseResult.success) {
    const errorMessage =
      reviseResult.errorMessage || "Failed to revise eBay listing.";

    await measure("database-write", () => prisma.$transaction(async (tx) => {
      await tx.priceHistory.updateMany({
        where: {
          productId: input.product.id,
          createdAt: input.checkedAt,
          appliedAt: null,
        },
        data: {
          ebayRevised: false,
          errorMessage,
        },
      });

      await tx.product.update({
        where: { id: input.product.id },
        data: {
          priceCheckError:
            `Automatic price increase could not be applied to eBay: ${errorMessage}`,
          priceCheckFailureCode: PriceCheckFailureCode.TECHNICAL_ERROR,
        },
      });
    }));

    return { success: false as const, errorMessage };
  }

  await measure("database-write", () => prisma.$transaction(async (tx) => {
    await Promise.all(
      input.variants.map((variant) =>
        tx.variant.update({
          where: { id: variant.id },
          data: {
            buyPrice: toMoneyDecimal(variant.nextBuyPrice),
            sellPrice: toMoneyDecimal(variant.nextSellPrice),
          },
        }),
      ),
    );

    await tx.product.update({
      where: { id: input.product.id },
      data: {
        price: toMoneyDecimal(input.nextPrimarySellPrice),
        priceCheckError: null,
        priceCheckFailureCode: null,
      },
    });

    await tx.priceHistory.updateMany({
      where: {
        productId: input.product.id,
        createdAt: input.checkedAt,
        appliedAt: null,
      },
      data: {
        appliedAt: input.checkedAt,
        ebayRevised: true,
        errorMessage: null,
      },
    });
  }));

  return { success: true as const, errorMessage: null };
}

function getSimulatedPrice(
  simulatedPrices: Record<string, number> | undefined,
  productId: string
) {
  if (!simulatedPrices) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(simulatedPrices, productId)) {
    return null;
  }

  const value = simulatedPrices[productId];
  return Number.isFinite(value) ? roundMoney(value) : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected price check error";
}

function getAmazonStockUpdate(stockLeft: number | null | undefined) {
  return stockLeft === undefined ? {} : { amazonStockLeft: stockLeft };
}

function emptyPriceCheckResult(): PriceCheckResult {
  return {
    checked: 0,
    changed: 0,
    pendingReview: 0,
    failed: 0,
    skipped: 0,
    unchanged: 0,
    fresh: 0,
    unavailable: 0,
    technicalErrors: 0,
    needsVerification: 0,
    listingUpdateFailures: 0,
    retryAttempts: 0,
    classificationAvailable: true,
  };
}

export async function runPriceCheck(
  options: RunPriceCheckOptions = {}
): Promise<PriceCheckResult> {
  const optimizationConfig =
    options.optimizationConfig ??
    resolvePriceCheckOptimizationConfig(options.storeId);
  const timing = new PriceCheckTimingRecorder(optimizationConfig.timingEnabled);
  let runOutcome: "completed" | "cancelled" | "failed" = "completed";

  if (optimizationConfig.unknown.length > 0) {
    logger.warn(
      "price-checker/config",
      "Unknown price-check optimization disabled all requested optimizations",
      {
        jobId: options.jobId,
        storeId: options.storeId,
        unknown: optimizationConfig.unknown,
      },
    );
  }

  const supplierSettings = await getSupplierSettings(options.storeId);
  const deliveryState =
    optimizationConfig.enabled.includes("delivery-state") &&
    supplierSettings.scrapePostcode
      ? createAmazonDeliveryStateSession(supplierSettings.scrapePostcode)
      : undefined;

  if (!options.ignoreSchedule && !supplierSettings.priceTrackingEnabled) {
    return { ...emptyPriceCheckResult(), reason: "Price tracking is disabled." };
  }

  if (!options.ignoreSchedule) {
    const currentUtcHour = new Date().getUTCHours();

    if (currentUtcHour !== supplierSettings.priceCheckHour) {
      return {
        ...emptyPriceCheckResult(),
        reason: `Current UTC hour ${currentUtcHour} does not match configured hour ${supplierSettings.priceCheckHour}.`,
      };
    }
  }

  const normalizedIds = Array.from(
    new Set(options.productIds?.map((id) => id.trim()).filter(Boolean) ?? []),
  );
  const restrictToIds = normalizedIds.length > 0;

  const requestedOrder = new Map(normalizedIds.map((id, index) => [id, index]));
  const productsFromDb = await prisma.product.findMany({
    where: {
      status: {
        in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD],
      },
      ...(options.storeId ? { storeId: options.storeId } : {}),
      ...(restrictToIds ? { id: { in: normalizedIds } } : {}),
    },
    include: {
      store: true,
      variants: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const products = restrictToIds
    ? [...productsFromDb].sort(
        (left, right) =>
          (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      )
    : productsFromDb;

  if (products.length === 0 && !restrictToIds) {
    return emptyPriceCheckResult();
  }

  const runTotal = restrictToIds ? normalizedIds.length : products.length;
  const result = emptyPriceCheckResult();
  const measureStage = async <T>(stage: string, operation: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      timing.record(stage, Date.now() - startedAt);
    }
  };
  const productStartedAt = new Map<string, number>();
  const reportProgress = async () => {
    if (!options.onProgress) {
      return;
    }

    try {
      await measureStage("progress-write", () =>
        Promise.resolve(options.onProgress?.({ ...result, total: runTotal })),
      );
    } catch (error) {
      logger.warn("price-checker/run", "Price check progress callback failed", {
        errorMessage: getErrorMessage(error),
      });
    }
  };
  const reportProductComplete = async (completion: PriceCheckProductCompletion) => {
    const productId = completion.productId;
    result.checked += 1;
    if (completion.outcome === "FRESH") result.fresh += 1;
    if (completion.outcome === "UNAVAILABLE") result.unavailable += 1;
    if (completion.outcome === "TECHNICAL_ERROR") result.technicalErrors += 1;
    if (completion.outcome === "NEEDS_VERIFICATION") result.needsVerification += 1;
    if (completion.outcome === "SKIPPED") result.skipped += 1;
    if (completion.listingUpdateFailed) result.listingUpdateFailures += 1;
    result.retryAttempts += completion.retryAttempts;

    const startedAt = productStartedAt.get(productId);
    const completedWithDuration = {
      ...completion,
      durationMs:
        completion.durationMs ??
        (startedAt === undefined ? null : Date.now() - startedAt),
    };
    try {
      await reportCompletedProductCallbacks({
        completionIncludesProgress:
          options.completionIncludesProgress === true,
        reportProgress,
        reportCompletion: options.onProductComplete
          ? () =>
              measureStage("checkpoint-write", () =>
                Promise.resolve(
                  options.onProductComplete?.(productId, {
                    ...result,
                    total: runTotal,
                  }, completedWithDuration),
                ),
              )
          : undefined,
        onCompletionError: (error) => {
          logger.warn(
            "price-checker/run",
            "Price check completion callback failed",
            {
              productId,
              errorMessage: getErrorMessage(error),
            },
          );
        },
      });
    } finally {
      if (startedAt !== undefined) {
        timing.record("product-total", Date.now() - startedAt);
        productStartedAt.delete(productId);
      }
    }
  };
  const recordProductFailure = async (input: PriceCheckProductFailure) => {
    await measureStage("database-write", () =>
      prisma.product.update({
        where: { id: input.productId },
        data: {
          lastPriceCheck: input.checkedAt,
          priceCheckError: input.message,
          priceCheckFailureCode: input.code,
        },
      }),
    );
    result.failed += 1;

    if (!options.onProductFailure) {
      return;
    }

    try {
      await options.onProductFailure(input);
    } catch (error) {
      logger.warn("price-checker/run", "Price check failure callback failed", {
        productId: input.productId,
        failureCode: input.code,
        errorMessage: getErrorMessage(error),
      });
    }
  };
  const checkCancelled = async () => {
    if (!options.shouldCancel) {
      return false;
    }

    try {
      return await options.shouldCancel();
    } catch (error) {
      logger.warn("price-checker/run", "Price check cancellation check failed", {
        errorMessage: getErrorMessage(error),
      });
      return false;
    }
  };
  const invalidateRunCaches = () => {
    if (options.storeId) {
      invalidatePriceCaches(options.storeId);
    }
  };
  const finishCancelled = () => {
    runOutcome = "cancelled";
    invalidateRunCaches();

    return {
      ...result,
      reason: "Price check cancelled.",
      cancelled: true,
    };
  };

  await reportProgress();

  if (restrictToIds) {
    const foundProductIds = new Set(products.map((product) => product.id));
    for (const productId of normalizedIds) {
      if (foundProductIds.has(productId)) continue;
      await reportProductComplete({
        productId,
        productAsin: null,
        productTitle: null,
        outcome: "SKIPPED",
        failureCode: null,
        message: "Product no longer exists or is no longer eligible for checking.",
        listingUpdateFailed: false,
        retryAttempts: 0,
        durationMs: null,
        checkedAt: null,
      });
    }
  }

  let sharedBrowser: Browser | null = null;
  const getSharedBrowser = async () => {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      sharedBrowser = await launchScraperBrowser();
    }
    return sharedBrowser;
  };
  const closeSharedBrowser = async () => {
    if (deliveryState) {
      resetAmazonDeliveryState(deliveryState);
    }
    if (sharedBrowser) {
      const browserToClose = sharedBrowser;
      sharedBrowser = null;
      await browserToClose.close().catch(() => {});
    }
  };

  const scrapeAmazonPriceWithRetry = async (
    productId: string,
    asin: string,
    priceTrackingMode: AmazonPriceTrackingMode,
    variantHints?: VariantSelectionHints | null,
    shouldAbort: () => boolean = () => false,
    onRetry: () => void = () => {},
  ) => {
    const scrapeWithBrowser = async (allowDeliveryStateReuse: boolean) => {
      const browser = await getSharedBrowser();
      timing.increment("scrape-attempts");
      const sharedSnapshot = optimizationConfig.enabled.includes(
        "shared-snapshot",
      );
      return scrapeAmazonPrice(
        asin,
        browser,
        supplierSettings.scrapePostcode || undefined,
        priceTrackingMode,
        variantHints,
        timing.enabled || sharedSnapshot || deliveryState
          ? {
              ...(timing.enabled
                ? {
                    onTiming: (stage: string, durationMs: number) =>
                      timing.record(stage, durationMs),
                  }
                : {}),
              sharedSnapshot,
              deliveryState,
              allowDeliveryStateReuse,
              onDeliveryStateEvent: (event) =>
                timing.increment(`delivery-state-${event}`),
            }
          : undefined,
      );
    };

    try {
      return await scrapeWithBrowser(true);
    } catch (error) {
      timing.increment("scrape-retries");
      onRetry();
      await closeSharedBrowser();

      if (shouldAbort()) {
        throw error;
      }

      logger.warn(
        "price-checker/run",
        "Amazon scrape failed; retrying with a fresh browser",
        {
          productId,
          asin,
          priceTrackingMode,
          errorMessage: getErrorMessage(error),
        }
      );

      // Brief pause before retry — gives the OS time to release
      // browser process resources after a crash.
      await measureStage("retry-backoff", () => sleep(2000));

      try {
        return await scrapeWithBrowser(false);
      } catch (retryError) {
        await closeSharedBrowser();

        logger.warn("price-checker/run", "Amazon scrape retry failed", {
          productId,
          asin,
          priceTrackingMode,
          errorMessage: getErrorMessage(retryError),
        });

        throw retryError;
      }
    }
  };

  try {
    for (const [index, product] of products.entries()) {
      if (await checkCancelled()) {
        return finishCancelled();
      }

      productStartedAt.set(product.id, Date.now());

      const checkedAt = new Date();
      let productRetryAttempts = 0;
      let listingUpdateFailed = false;
      const completeProduct = (
        outcome: PriceCheckProductOutcome,
        failureCode: PriceCheckFailureCode | null = null,
        message: string | null = null,
      ) =>
        reportProductComplete({
          productId: product.id,
          productAsin: product.asin,
          productTitle: product.fullTitle || product.title,
          outcome,
          failureCode,
          message,
          listingUpdateFailed,
          retryAttempts: productRetryAttempts,
          durationMs: null,
          checkedAt,
        });

      const prerequisiteIssue = getPriceCheckPrerequisiteIssue(product);

      if (prerequisiteIssue || !product.asin) {
        const skipReason = prerequisiteIssue === "missing-variants"
          ? "No variants found"
          : "Missing Amazon ASIN";

        await measureStage("database-write", () => prisma.product.update({
          where: { id: product.id },
          data: {
            lastPriceCheck: null,
            priceCheckError: null,
            priceCheckFailureCode: null,
          },
        }));

        logger.info("price-checker/run", "Price check skipped for untracked product", {
          productId: product.id,
          asin: product.asin,
          reason: skipReason,
        });

        await completeProduct("SKIPPED", null, skipReason);
        continue;
      }

      const simulatedAmazonPrice = getSimulatedPrice(
        options.simulatedPrices,
        product.id
      );
      const priceHistorySource =
        simulatedAmazonPrice !== null ? "SIMULATED" : "LIVE";
      const priceTrackingMode = normalizeAmazonPriceTrackingMode(
        product.amazonPriceTrackingMode
      );
      const variantHints = extractVariantSelectionHints(product);

      try {
        let currentAmazonPrice: number | null;
        let scrapedAmazonStockLeft: number | null | undefined;
        let scrapeResult: ScrapedAmazonPrice | undefined;

        if (simulatedAmazonPrice !== null) {
          currentAmazonPrice = simulatedAmazonPrice;
        } else {
          let scrapeTimedOut = false;
          const timeoutMessage =
            `Price check timed out after ${Math.round(PRODUCT_CHECK_TIMEOUT_MS / 1000)}s while scraping Amazon.`;

          try {
            scrapeResult = await withTimeout(
              scrapeAmazonPriceWithRetry(
                product.id,
                product.asin,
                priceTrackingMode,
                variantHints,
                () => scrapeTimedOut,
                () => {
                  productRetryAttempts += 1;
                },
              ),
              PRODUCT_CHECK_TIMEOUT_MS,
              timeoutMessage,
            );
          } catch (error) {
            if (getErrorMessage(error) === timeoutMessage) {
              scrapeTimedOut = true;
              await closeSharedBrowser();
            }
            throw error;
          }

          currentAmazonPrice = scrapeResult.price;
          scrapedAmazonStockLeft = scrapeResult.stockLeft;
        }

        const amazonStockUpdate = getAmazonStockUpdate(scrapedAmazonStockLeft);
        const lowStockResolvedUpdate = getLowStockResolvedUpdate(
          product,
          scrapedAmazonStockLeft
        );

        if (currentAmazonPrice === null) {
          if (scrapeResult?.variantSelectionFailed) {
            await recordProductFailure({
              productId: product.id,
              code: PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED,
              message:
                scrapeResult.variantSelectionReason ||
                "Amazon presents product variations, but the saved colour/size could not be selected.",
              checkedAt,
            });

            logger.warn(
              "price-checker/run",
              "Amazon variant selection required",
              {
                productId: product.id,
                asin: product.asin,
                reason: scrapeResult.variantSelectionReason,
              }
            );

            await completeProduct(
              "NEEDS_VERIFICATION",
              PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED,
              scrapeResult.variantSelectionReason ||
                "Amazon presents product variations, but the saved colour/size could not be selected.",
            );
            continue;
          }

          await recordProductFailure({
            productId: product.id,
            code: PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
            message: getAmazonPriceUnavailableMessage(priceTrackingMode),
            checkedAt,
          });

          logger.warn("price-checker/run", "Amazon price unavailable", {
            productId: product.id,
            asin: product.asin,
            priceTrackingMode,
            requestedPrice: getAmazonPriceTrackingLabel(priceTrackingMode),
          });

          await completeProduct(
            "UNAVAILABLE",
            PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
            getAmazonPriceUnavailableMessage(priceTrackingMode),
          );
          continue;
        }

        const previousAmazonPrice =
          decimalToNumber(product.amazonPrice) ??
          decimalToNumber(product.variants[0]?.buyPrice);

        // First-time check: record the Amazon baseline and correct the
        // primary BUY price without revising the eBay listing.
        const isFirstCheck = product.amazonPrice === null;

        if (isFirstCheck) {
          result.unchanged += 1;

          const primaryVariant = product.variants[0];
          const currentAmazonPriceDecimal = toMoneyDecimal(currentAmazonPrice);

          await measureStage("database-write", () => prisma.$transaction(async (tx) => {
            await tx.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: currentAmazonPriceDecimal,
                ...amazonStockUpdate,
                ...lowStockResolvedUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
                priceCheckFailureCode: null,
              },
            });

            await tx.variant.update({
              where: { id: primaryVariant.id },
              data: {
                buyPrice: currentAmazonPriceDecimal,
              },
            });
          }));

          logger.info("price-checker/run", "First check — baseline established", {
            productId: product.id,
            asin: product.asin,
            baselinePrice: currentAmazonPrice,
            priceTrackingMode,
          });

          await completeProduct("FRESH");
          continue;
        }

        if (!previousAmazonPrice || previousAmazonPrice <= 0) {
          await recordProductFailure({
            productId: product.id,
            code: PriceCheckFailureCode.MISSING_BASELINE,
            message: "Tracked product has no baseline Amazon buy price.",
            checkedAt,
          });

          logger.warn("price-checker/run", "Missing baseline Amazon price", {
            productId: product.id,
            asin: product.asin,
          });

          await completeProduct(
            "NEEDS_VERIFICATION",
            PriceCheckFailureCode.MISSING_BASELINE,
            "Tracked product has no baseline Amazon buy price.",
          );
          continue;
        }

        if (!hasMoneyChanged(previousAmazonPrice, currentAmazonPrice)) {
          // Amazon price hasn't changed, but check if the primary variant's
          // buyPrice is out of sync with the Amazon price. This happens when
          // the variant was imported with buyPrice = sellPrice (markup baked
          // in) or when the user updates fee/profit settings without fixing
          // the buyPrice.
          const primaryVariant = product.variants[0];
          const primaryBuyPrice = primaryVariant
            ? (decimalToNumber(primaryVariant.buyPrice) ?? 0)
            : 0;

          const buyPriceMismatch =
            primaryVariant &&
            hasMoneyChanged(primaryBuyPrice, currentAmazonPrice);

          if (!buyPriceMismatch) {
            result.unchanged += 1;

            await measureStage("database-write", () => prisma.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: toMoneyDecimal(currentAmazonPrice),
                ...amazonStockUpdate,
                ...lowStockResolvedUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
                priceCheckFailureCode: null,
              },
            }));

            await completeProduct("FRESH");
            continue;
          }

          // buyPrice ≠ amazonPrice — create a pending review to correct it.
          logger.info("price-checker/run", "Variant buyPrice mismatch detected", {
            productId: product.id,
            asin: product.asin,
            primaryBuyPrice,
            amazonPrice: currentAmazonPrice,
          });

          const mismatchVariants = product.variants.map((variant, idx) => {
            const prevBuy = decimalToNumber(variant.buyPrice) ?? 0;
            const prevSell = decimalToNumber(variant.sellPrice) ?? 0;
            const nextBuy = idx === 0
              ? roundMoney(currentAmazonPrice)
              : prevBuy;

            const hasFeeOrProfit =
              variant.feesPercent > 0 ||
              variant.feesFixed > 0 ||
              variant.profitPercent > 0 ||
              variant.profitFixed > 0;

            let nextSell: number;
            if (hasFeeOrProfit) {
              nextSell = calculateSellPrice({
                buyPrice: nextBuy,
                feesPercent: variant.feesPercent,
                feesFixed: variant.feesFixed,
                profitPercent: variant.profitPercent,
                profitFixed: variant.profitFixed,
                roundCents: variant.roundCents,
                minimumProfit: supplierSettings.minimumProfit,
              });
            } else {
              // Preserve dollar margin when no fees configured
              const margin = prevSell - (previousAmazonPrice ?? prevBuy);
              nextSell = roundMoney(Math.max(nextBuy, nextBuy + margin));
            }

            return {
              id: variant.id,
              previousBuyPrice: prevBuy,
              nextBuyPrice: nextBuy,
              previousSellPrice: prevSell,
              nextSellPrice: nextSell,
            };
          });

          const mismatchChangePercent =
            ((currentAmazonPrice - primaryBuyPrice) / primaryBuyPrice) * 100;

          await measureStage("database-write", () => prisma.$transaction(async (tx) => {
            await tx.priceHistory.updateMany({
              where: {
                productId: product.id,
                appliedAt: null,
              },
              data: {
                appliedAt: checkedAt,
                ebayRevised: false,
                errorMessage: null,
              },
            });

            await tx.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: toMoneyDecimal(currentAmazonPrice),
                ...amazonStockUpdate,
                ...lowStockResolvedUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
                priceCheckFailureCode: null,
              },
            });

            await tx.priceHistory.createMany({
              data: mismatchVariants.map((variant) => ({
                productId: product.id,
                variantId: variant.id,
                previousPrice: toMoneyDecimal(variant.previousBuyPrice),
                newPrice: toMoneyDecimal(variant.nextBuyPrice),
                previousSellPrice: toMoneyDecimal(variant.previousSellPrice),
                newSellPrice: toMoneyDecimal(variant.nextSellPrice),
                changePercent: roundMoney(mismatchChangePercent),
                ebayRevised: false,
                errorMessage: null,
                source: priceHistorySource,
                amazonPriceTrackingMode: priceTrackingMode,
                appliedAt: null,
                createdAt: checkedAt,
              })),
            });
          }));

          result.changed += 1;
          const mismatchPrimarySellPrice =
            mismatchVariants[0]?.nextSellPrice;

          if (
            mismatchPrimarySellPrice !== undefined &&
            shouldAutomaticallyApplyPriceIncrease(
              primaryBuyPrice,
              currentAmazonPrice,
            )
          ) {
            const automaticApplication =
              await automaticallyApplyPriceIncrease({
                product,
                variants: mismatchVariants,
                nextPrimarySellPrice: mismatchPrimarySellPrice,
                checkedAt,
                recordTiming: (stage, durationMs) => timing.record(stage, durationMs),
              });

            if (automaticApplication.success) {
              logger.info(
                "price-checker/run",
                "BuyPrice increase applied automatically",
                {
                  productId: product.id,
                  asin: product.asin,
                  oldBuyPrice: primaryBuyPrice,
                  newBuyPrice: currentAmazonPrice,
                  newSellPrice: mismatchPrimarySellPrice,
                  priceTrackingMode,
                },
              );
            } else {
              result.pendingReview += 1;
              result.failed += 1;
              listingUpdateFailed = true;

              logger.warn(
                "price-checker/run",
                "Automatic BuyPrice increase application failed; review retained",
                {
                  productId: product.id,
                  asin: product.asin,
                  errorMessage: automaticApplication.errorMessage,
                },
              );
            }
          } else {
            result.pendingReview += 1;

            logger.info(
              "price-checker/run",
              "BuyPrice correction recorded for review",
              {
                productId: product.id,
                asin: product.asin,
                oldBuyPrice: primaryBuyPrice,
                newBuyPrice: currentAmazonPrice,
                newSellPrice: mismatchPrimarySellPrice,
                priceTrackingMode,
              },
            );
          }

          await completeProduct("FRESH");
          continue;
        }

        const changeRatio = currentAmazonPrice / previousAmazonPrice;
        const changePercent =
          ((currentAmazonPrice - previousAmazonPrice) / previousAmazonPrice) * 100;

        const nextVariants = product.variants.map((variant, variantIndex) => {
          const previousBuyPrice = decimalToNumber(variant.buyPrice) ?? 0;
          const previousSellPrice = decimalToNumber(variant.sellPrice) ?? 0;

          // For the primary variant (index 0), set buyPrice directly to the
          // current Amazon price. For additional variants, scale proportionally
          // using the change ratio so they maintain their relative pricing.
          const nextBuyPrice =
            variantIndex === 0
              ? roundMoney(currentAmazonPrice)
              : roundMoney(previousBuyPrice * changeRatio);

          const hasFeeOrProfit =
            variant.feesPercent > 0 ||
            variant.feesFixed > 0 ||
            variant.profitPercent > 0 ||
            variant.profitFixed > 0;

          let nextSellPrice: number;

          if (hasFeeOrProfit) {
            // Normal path: recalculate sell price from the new buy price using
            // the variant's fee/profit settings.
            nextSellPrice = calculateSellPrice({
              buyPrice: nextBuyPrice,
              feesPercent: variant.feesPercent,
              feesFixed: variant.feesFixed,
              profitPercent: variant.profitPercent,
              profitFixed: variant.profitFixed,
              roundCents: variant.roundCents,
              minimumProfit: supplierSettings.minimumProfit,
            });
          } else {
            // Fallback for variants where the markup was baked into buyPrice
            // (fees and profit are all zero). Preserve the dollar margin
            // between the old Amazon price and the old sell price so the user
            // doesn't lose their entire markup.
            const dollarMargin = previousSellPrice - (previousAmazonPrice ?? previousBuyPrice);
            nextSellPrice = roundMoney(Math.max(nextBuyPrice, nextBuyPrice + dollarMargin));
          }

          return {
            id: variant.id,
            previousBuyPrice,
            nextBuyPrice,
            previousSellPrice,
            nextSellPrice,
          };
        });

        const nextPrimarySellPrice = nextVariants[0]?.nextSellPrice;

        if (nextPrimarySellPrice === undefined) {
          await completeProduct(
            "SKIPPED",
            null,
            "No primary variant price was available to evaluate.",
          );
          continue;
        }

        await measureStage("database-write", () => prisma.$transaction(async (tx) => {
          await tx.priceHistory.updateMany({
            where: {
              productId: product.id,
              appliedAt: null,
            },
            data: {
              appliedAt: checkedAt,
              ebayRevised: false,
              errorMessage: null,
            },
          });

          await tx.product.update({
            where: { id: product.id },
            data: {
              amazonPrice: toMoneyDecimal(currentAmazonPrice),
              ...amazonStockUpdate,
              ...lowStockResolvedUpdate,
              lastPriceCheck: checkedAt,
              priceCheckError: null,
              priceCheckFailureCode: null,
            },
          });

          await tx.priceHistory.createMany({
            data: nextVariants.map((variant) => ({
              productId: product.id,
              variantId: variant.id,
              previousPrice: toMoneyDecimal(variant.previousBuyPrice),
              newPrice: toMoneyDecimal(variant.nextBuyPrice),
              previousSellPrice: toMoneyDecimal(variant.previousSellPrice),
              newSellPrice: toMoneyDecimal(variant.nextSellPrice),
              changePercent,
              ebayRevised: false,
              errorMessage: null,
              source: priceHistorySource,
              amazonPriceTrackingMode: priceTrackingMode,
              appliedAt: null,
              createdAt: checkedAt,
            })),
          });
        }));

        result.changed += 1;

        if (
          shouldAutomaticallyApplyPriceIncrease(
            previousAmazonPrice,
            currentAmazonPrice,
          )
        ) {
          const automaticApplication = await automaticallyApplyPriceIncrease({
            product,
            variants: nextVariants,
            nextPrimarySellPrice,
            checkedAt,
            recordTiming: (stage, durationMs) => timing.record(stage, durationMs),
          });

          if (automaticApplication.success) {
            logger.info(
              "price-checker/run",
              "Tracked price increase applied automatically",
              {
                productId: product.id,
                asin: product.asin,
                previousAmazonPrice,
                currentAmazonPrice,
                newSellPrice: nextPrimarySellPrice,
                changePercent: roundMoney(changePercent),
                usedSimulatedPrice: simulatedAmazonPrice !== null,
                priceTrackingMode,
              },
            );
          } else {
            result.pendingReview += 1;
            result.failed += 1;
            listingUpdateFailed = true;

            logger.warn(
              "price-checker/run",
              "Automatic price increase application failed; review retained",
              {
                productId: product.id,
                asin: product.asin,
                errorMessage: automaticApplication.errorMessage,
              },
            );
          }
        } else {
          result.pendingReview += 1;

          logger.info(
            "price-checker/run",
            "Tracked product price change recorded for review",
            {
              productId: product.id,
              asin: product.asin,
              previousAmazonPrice,
              currentAmazonPrice,
              changePercent: roundMoney(changePercent),
              usedSimulatedPrice: simulatedAmazonPrice !== null,
              priceTrackingMode,
            },
          );
        }
      } catch (error) {
        const rawMessage = getErrorMessage(error);
        const message = getBrowserLaunchUserMessage(error) ?? rawMessage;
        const code = getPriceCheckFailureCode(error);

        await recordProductFailure({
          productId: product.id,
          code,
          message,
          checkedAt,
        });

        logger.error("price-checker/run", "Price check failed", error, {
          productId: product.id,
          asin: product.asin,
          failureCode: code,
        });

        await completeProduct(
          getPriceCheckProductOutcomeForFailure(code),
          code,
          message,
        );
        continue;
      }

      await completeProduct("FRESH");

      if (await checkCancelled()) {
        return finishCancelled();
      }

      if (simulatedAmazonPrice === null && index < products.length - 1) {
        if (await checkCancelled()) {
          return finishCancelled();
        }

        await measureStage("pacing-sleep", () => sleep(getProductDelayMs()));
      }
    }
  } catch (error) {
    runOutcome = "failed";
    throw error;
  } finally {
    await closeSharedBrowser();
    invalidateRunCaches();
    if (timing.enabled) {
      logger.info("price-checker/timing", "Price check timing summary", {
        jobId: options.jobId,
        storeId: options.storeId,
        outcome: runOutcome,
        optimizations: optimizationConfig.enabled,
        result,
        timing: timing.snapshot(),
      });
    }
  }

  return result;
}
