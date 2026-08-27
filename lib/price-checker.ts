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
import { launchScraperBrowser } from "@/lib/scraper-browser";
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
import { getPriceCheckFailureCode } from "@/lib/price-check-failures";
import { getLowStockResolvedUpdate } from "@/lib/low-stock-products";
import { shouldAutomaticallyApplyPriceIncrease } from "@/lib/price-change-automation";

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

interface RunPriceCheckOptions {
  storeId?: string;
  productIds?: string[];
  ignoreSchedule?: boolean;
  simulatedPrices?: Record<string, number>;
  onProgress?: (progress: PriceCheckProgress) => void | Promise<void>;
  onProductComplete?: (
    productId: string,
    progress: PriceCheckProgress
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
}) {
  let reviseResult: Awaited<ReturnType<typeof reviseProductPrice>>;

  try {
    reviseResult = await reviseProductPrice(
      input.product,
      input.nextPrimarySellPrice,
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

    await prisma.$transaction(async (tx) => {
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
    });

    return { success: false as const, errorMessage };
  }

  await prisma.$transaction(async (tx) => {
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
  });

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

export async function runPriceCheck(
  options: RunPriceCheckOptions = {}
): Promise<PriceCheckResult> {
  const supplierSettings = await getSupplierSettings(options.storeId);

  if (!options.ignoreSchedule && !supplierSettings.priceTrackingEnabled) {
    return {
      checked: 0,
      changed: 0,
      pendingReview: 0,
      failed: 0,
      skipped: 0,
      reason: "Price tracking is disabled.",
    };
  }

  if (!options.ignoreSchedule) {
    const currentUtcHour = new Date().getUTCHours();

    if (currentUtcHour !== supplierSettings.priceCheckHour) {
      return {
        checked: 0,
        changed: 0,
        pendingReview: 0,
        failed: 0,
        skipped: 0,
        reason: `Current UTC hour ${currentUtcHour} does not match configured hour ${supplierSettings.priceCheckHour}.`,
      };
    }
  }

  const normalizedIds =
    options.productIds?.map((id) => id.trim()).filter(Boolean) ?? [];
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

  if (products.length === 0) {
    return { checked: 0, changed: 0, pendingReview: 0, failed: 0, skipped: 0 };
  }

  const result: PriceCheckResult = {
    checked: 0,
    changed: 0,
    pendingReview: 0,
    failed: 0,
    skipped: 0,
  };
  const reportProgress = async () => {
    if (!options.onProgress) {
      return;
    }

    try {
      await options.onProgress({ ...result, total: products.length });
    } catch (error) {
      logger.warn("price-checker/run", "Price check progress callback failed", {
        errorMessage: getErrorMessage(error),
      });
    }
  };
  const reportProductComplete = async (productId: string) => {
    await reportProgress();

    if (!options.onProductComplete) {
      return;
    }

    try {
      await options.onProductComplete(productId, { ...result, total: products.length });
    } catch (error) {
      logger.warn("price-checker/run", "Price check completion callback failed", {
        productId,
        errorMessage: getErrorMessage(error),
      });
    }
  };
  const recordProductFailure = async (input: PriceCheckProductFailure) => {
    await prisma.product.update({
      where: { id: input.productId },
      data: {
        lastPriceCheck: input.checkedAt,
        priceCheckError: input.message,
        priceCheckFailureCode: input.code,
      },
    });
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
    invalidateRunCaches();

    return {
      ...result,
      reason: "Price check cancelled.",
      cancelled: true,
    };
  };

  await reportProgress();

  let sharedBrowser: Browser | null = null;
  const getSharedBrowser = async () => {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      sharedBrowser = await launchScraperBrowser();
    }
    return sharedBrowser;
  };
  const closeSharedBrowser = async () => {
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
    shouldAbort: () => boolean = () => false,
  ) => {
    const scrapeWithBrowser = async () => {
      const browser = await getSharedBrowser();
      return scrapeAmazonPrice(
        asin,
        browser,
        supplierSettings.scrapePostcode || undefined,
        priceTrackingMode
      );
    };

    try {
      return await scrapeWithBrowser();
    } catch (error) {
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

      try {
        return await scrapeWithBrowser();
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

    result.checked += 1;

      const checkedAt = new Date();

      const prerequisiteIssue = getPriceCheckPrerequisiteIssue(product);

      if (prerequisiteIssue || !product.asin) {
        const skipReason = prerequisiteIssue === "missing-variants"
          ? "No variants found"
          : "Missing Amazon ASIN";

        result.skipped += 1;

        await prisma.product.update({
          where: { id: product.id },
          data: {
            lastPriceCheck: null,
            priceCheckError: null,
            priceCheckFailureCode: null,
          },
        });

        logger.info("price-checker/run", "Price check skipped for untracked product", {
          productId: product.id,
          asin: product.asin,
          reason: skipReason,
        });

        await reportProductComplete(product.id);
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

      try {
        let currentAmazonPrice: number | null;
        let scrapedAmazonStockLeft: number | null | undefined;

        if (simulatedAmazonPrice !== null) {
          currentAmazonPrice = simulatedAmazonPrice;
        } else {
          let scrapeTimedOut = false;
          const timeoutMessage =
            `Price check timed out after ${Math.round(PRODUCT_CHECK_TIMEOUT_MS / 1000)}s while scraping Amazon.`;
          let scrapeResult: ScrapedAmazonPrice;

          try {
            scrapeResult = await withTimeout(
              scrapeAmazonPriceWithRetry(
                product.id,
                product.asin,
                priceTrackingMode,
                () => scrapeTimedOut,
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

          await reportProductComplete(product.id);
          continue;
        }

        const previousAmazonPrice =
          decimalToNumber(product.amazonPrice) ??
          decimalToNumber(product.variants[0]?.buyPrice);

        // First-time check: record the Amazon baseline and correct the
        // primary BUY price without revising the eBay listing.
        const isFirstCheck = product.amazonPrice === null;

        if (isFirstCheck) {
          result.skipped += 1;

          const primaryVariant = product.variants[0];
          const currentAmazonPriceDecimal = toMoneyDecimal(currentAmazonPrice);

          await prisma.$transaction(async (tx) => {
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
          });

          logger.info("price-checker/run", "First check — baseline established", {
            productId: product.id,
            asin: product.asin,
            baselinePrice: currentAmazonPrice,
            priceTrackingMode,
          });

          await reportProductComplete(product.id);
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

          await reportProductComplete(product.id);
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
            result.skipped += 1;

            await prisma.product.update({
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

            await reportProductComplete(product.id);
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

          await prisma.$transaction(async (tx) => {
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
          });

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

          await reportProductComplete(product.id);
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
          result.skipped += 1;
          await reportProductComplete(product.id);
          continue;
        }

        await prisma.$transaction(async (tx) => {
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
        });

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
        const message = getErrorMessage(error);
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
      }

      await reportProductComplete(product.id);

      if (await checkCancelled()) {
        return finishCancelled();
      }

      if (simulatedAmazonPrice === null && index < products.length - 1) {
        if (await checkCancelled()) {
          return finishCancelled();
        }

        await sleep(getProductDelayMs());
      }
    }
  } finally {
    await closeSharedBrowser();
    invalidateRunCaches();
  }

  return result;
}
