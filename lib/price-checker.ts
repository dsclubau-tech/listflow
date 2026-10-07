import { randomUUID } from "node:crypto";
import { acquirePriceCheckResultLease, assertAmazonObservationCurrent, SupersededAmazonObservation, PriceCheckResultDeferred, runObservedPriceWrite } from "@/lib/price-check-result-application";
import type { WorkerContext } from "@/lib/job-coordination";
import type { Browser } from "playwright-core";
import { getPriceCheckProductDelayMs, resolvePriceCheckProductPacing } from "@/lib/price-check-pacing";
import { Prisma } from "@/app/generated/prisma/client";
import {
  PriceCheckFailureCode,
  ProductStatus,
  AmazonAvailability,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { queuePriceCheckAutoResumeForProduct } from "@/lib/price-check-auto-resume";
import { queueAmazonShippingHold } from "./price-check-auto-hold";
import { evaluateAmazonShipping } from "./amazon-shipping-evidence";
import { AmazonDeliveryFailure, shouldDeferAmazonDeliveryFailure } from "./amazon-delivery-recovery";
import { acquireDeliveryPermit, releaseDeliveryPermit, deferAmazonDelivery, confirmAmazonDelivery,
  type DeliveryPermit } from "./amazon-delivery-cooldown";
import { resolveAmazonDeliveryPostcode } from "@/lib/amazon-delivery-postcode";
import {
  scrapeAmazonPrice,
  type ScrapedAmazonPrice,
} from "@/lib/amazon-scraper";
import {
  getBrowserLaunchUserMessage,
  launchScraperBrowser,
} from "@/lib/scraper-browser";
import { calculateSellPrice } from "@/lib/variant-pricing";
import { writeEbayInventory } from "./ebay-inventory-writer";
import type { InventoryAuthorization, InventoryResult } from "./ebay-inventory";

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
  PriceCheckFailure,
} from "@/lib/price-check-failures";
import { getLowStockResolvedUpdate } from "@/lib/low-stock-products";
import {
  canAutomaticallyApplyTrackedPriceChange,
  shouldAutomaticallyApplyPriceChange,
} from "@/lib/price-change-automation";
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
const PRODUCT_PACING = resolvePriceCheckProductPacing();
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
  deferred?: boolean;
  retryAt?: string;
  waitReason?: string;
  technicalFailureCode?: string;
}

export type PriceCheckProgress = PriceCheckResult & { total: number };

export type PriceCheckProductFailure = {
  productId: string;
  code: PriceCheckFailureCode;
  message: string;
  checkedAt: Date;
};

interface RunPriceCheckOptions {
  jobId?: string;
  worker?: WorkerContext;
  optimizationConfig?: PriceCheckOptimizationConfig;
  completionIncludesProgress?: boolean;
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
  assertOwnership?: () => Promise<void>;
  beforeExternalWrite?: () => Promise<void>;
  withExternalWrite?: (write: () => Promise<Awaited<ReturnType<typeof reviseProductPrice>>>) =>
    Promise<Awaited<ReturnType<typeof reviseProductPrice>>>;
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
  return getPriceCheckProductDelayMs(PRODUCT_PACING);
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

export type InventoryPriceOutcome = {success:boolean;errorMessage?:string;outcomeUncertain?:boolean;variationResults?:InventoryResult[];retryEligible?:boolean;awaitingRestoration?:number};
export async function reviseProductPrice(product:RevisableProduct,overrideStartPrice?:number,
 options?:{prices:Array<{variantId:string;price:number;buyPrice?:number;priceHistoryIds?:string[]}>;requestKey:string;assertCurrent?:()=>Promise<void>;authorization?:InventoryAuthorization}):Promise<InventoryPriceOutcome> {
 if(!product.ebayItemId)throw new Error("Product is missing an eBay item ID.");
 const current=await prisma.product.findFirst({where:{id:product.id,storeId:product.storeId},include:{variants:{orderBy:{createdAt:"asc"}}}});
 if(!current)throw new Error("Product not found.");
 if(!options&&current.variants.length>1)throw new Error("An explicit price is required for each intended variation.");
 const price=overrideStartPrice??decimalToNumber(product.price);
 if(price===null)throw new Error("Product is missing a valid eBay price.");
 const prices=options?.prices??(current.variants[0]?[{variantId:current.variants[0].id,price}]:[]);
 return writeEbayInventory({productId:product.id,storeId:product.storeId,
  requestKey:options?.requestKey??"inventory:price:"+product.id+":"+String(current.lastPriceCheck?.getTime()??current.updatedAt.getTime())+":"+price,
  requests:prices.length?prices.map(p=>({variantId:p.variantId,price:p.price,priceHistoryIds:p.priceHistoryIds,localPatch:p.buyPrice!==undefined?{buyPrice:p.buyPrice}:undefined})):[{price}],
  assertCurrent:options?.assertCurrent, authorization: options?.authorization
 });
}
export async function confirmInventoryPriceHistories(result:InventoryPriceOutcome,productId:string,
 histories:Array<{id:string;variantId:string|null}>,appliedAt:Date) {
 const confirmed=new Set(result.variationResults?.filter(t=>t.state==="CONFIRMED").map(t=>t.target.variantId));
 const ids=histories.filter(h=>h.variantId&&confirmed.has(h.variantId)).map(h=>h.id);
 if(ids.length)await prisma.priceHistory.updateMany({where:{productId,id:{in:ids},appliedAt:null},
  data:{status:"APPLIED",ebayRevised:true,appliedAt,errorMessage:null}});
 return ids;
}

async function automaticallyApplyPriceIncrease(input: {
  product: RevisableProduct;
  variants: CalculatedVariantPrice[];
  nextPrimarySellPrice: number;
  checkedAt: Date;
  recordTiming?: (stage: string, durationMs: number) => void;
  assertOwnership?: () => Promise<void>;
  beforeExternalWrite?: () => Promise<void>;
  withExternalWrite?: RunPriceCheckOptions["withExternalWrite"];
}) {
  let reviseResult: Awaited<ReturnType<typeof reviseProductPrice>>;
  const measure = async <T>(stage: string, operation: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      if (stage === "database-write" || stage === "ebay-update") {
        await input.assertOwnership?.();
      }
      return await operation();
    } finally {
      input.recordTiming?.(stage, Date.now() - startedAt);
    }
  };

  try {
    reviseResult = await measure("ebay-update", async () => {
      const write = async () => {
        const current = await prisma.product.findUnique({
          where: { id: input.product.id },
          include: { variants: true },
        });
        const currentVariants = new Map(current?.variants.map((variant) => [variant.id, variant]));
        if (!current || current.lastPriceCheck?.getTime() !== input.checkedAt.getTime() ||
            current.amazonPriceTrackingMode !== input.product.amazonPriceTrackingMode ||
            current.status !== input.product.status ||
            Number(current.price) !== Number(input.product.price) ||
            input.variants.some((variant) => {
              const actual = currentVariants.get(variant.id);
              return !actual || Number(actual.buyPrice) !== variant.previousBuyPrice ||
                Number(actual.sellPrice) !== variant.previousSellPrice;
            })) {
          throw new Error("Listing changed while the price check was running; review before updating eBay.");
        }
        await input.assertOwnership?.();
        await input.beforeExternalWrite?.();
        const history = await prisma.priceHistory.findMany({ where: { productId: input.product.id, createdAt: input.checkedAt, appliedAt: null }, select: { id: true, variantId: true } });
        return reviseProductPrice(input.product,input.nextPrimarySellPrice,{prices:input.variants.map(v=>({variantId:v.id,price:v.nextSellPrice,buyPrice:v.nextBuyPrice,priceHistoryIds:history.filter(h=>h.variantId===v.id).map(h=>h.id)})), authorization:{source:"AUTOMATIC_POLICY",historyIds:history.map(h=>h.id)},
          requestKey:"inventory:auto-price:"+input.product.id+":"+input.checkedAt.toISOString(),assertCurrent:input.assertOwnership});
      };
      return input.withExternalWrite ? input.withExternalWrite(write) : write();
    });
  } catch (error) {
    reviseResult = {
      success: false,
      errorMessage: getErrorMessage(error),
    };
  }

  if (!reviseResult.success && reviseResult.awaitingRestoration && !reviseResult.outcomeUncertain && !reviseResult.variationResults?.some(t => t.state === "REJECTED")) {
    const histories = await prisma.priceHistory.findMany({ where: { productId: input.product.id, createdAt: input.checkedAt, appliedAt: null }, select: { id: true, variantId: true } });
    await confirmInventoryPriceHistories(reviseResult, input.product.id, histories, input.checkedAt);
    return { success: false as const, errorMessage: reviseResult.errorMessage, deferred: true };
  }
  if (!reviseResult.success) {
    const histories=await prisma.priceHistory.findMany({where:{productId:input.product.id,createdAt:input.checkedAt,appliedAt:null},select:{id:true,variantId:true}});
    await confirmInventoryPriceHistories(reviseResult,input.product.id,histories,input.checkedAt);
    const errorMessage =
      reviseResult.errorMessage || "Failed to revise eBay listing.";

    await measure("database-write", () => prisma.$transaction(async (tx) => {
      const claim = await tx.product.updateMany({
        where: { id: input.product.id, lastPriceCheck: input.checkedAt },
        data: { lastPriceCheck: input.checkedAt },
      });
      if (!claim.count) return;
      await tx.priceHistory.updateMany({
        where: {
          productId: input.product.id,
          createdAt: input.checkedAt,
          appliedAt: null,
        },
        data: {
          ebayRevised: false,
          errorMessage,
          status: "FAILED",
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
    const claim = await tx.product.updateMany({
      where: { id: input.product.id, lastPriceCheck: input.checkedAt },
      data: { lastPriceCheck: input.checkedAt },
    });
    if (!claim.count) return;
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
        status: "APPLIED",
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

function getAmazonAvailabilityUpdate(input: {
  price: number | null;
  stockLeft: number | null | undefined;
  failureCode?: PriceCheckFailureCode | null;
  buyBoxOutcome?: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  identityOutcome?: "MATCH" | "MISMATCH" | "UNKNOWN";
}) {
  if (input.failureCode === PriceCheckFailureCode.AMAZON_OUT_OF_STOCK || input.stockLeft === 0) {
    return { amazonAvailability: AmazonAvailability.OUT_OF_STOCK };
  }
  if (
    input.price !== null &&
    input.failureCode === null &&
    input.buyBoxOutcome !== "UNAVAILABLE" &&
    input.identityOutcome !== "MISMATCH"
  ) {
    return { amazonAvailability: AmazonAvailability.IN_STOCK };
  }
  return { amazonAvailability: AmazonAvailability.UNKNOWN };
}

export async function runPriceCheck(
  options: RunPriceCheckOptions = {}
): Promise<PriceCheckResult> {
  const optimizationConfig =
    options.optimizationConfig ??
    resolvePriceCheckOptimizationConfig(options.storeId);
  const timing = new PriceCheckTimingRecorder(optimizationConfig.timingEnabled);
  let runOutcome: "completed" | "cancelled" | "failed" | "deferred" = "completed";

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

  if (optimizationConfig.deliveryStateConfigurationIssue) {
    logger.warn("price-checker/config", optimizationConfig.deliveryStateConfigurationIssue, {
      jobId: options.jobId,
      storeId: options.storeId,
      deliveryStateMode: optimizationConfig.deliveryStateMode,
    });
  }

  const supplierSettings = await getSupplierSettings(options.storeId);
  const scrapePostcode = resolveAmazonDeliveryPostcode(supplierSettings.scrapePostcode);
  const deliveryState =
    optimizationConfig.enabled.includes("delivery-state") &&
    scrapePostcode
      ? createAmazonDeliveryStateSession(scrapePostcode)
      : undefined;
  const deliveryEvents: Record<string, number> = {};

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
  let applicationLease: Awaited<ReturnType<typeof acquirePriceCheckResultLease>> | undefined;
  const assertApplicationOwnership = async () => {
    await options.assertOwnership?.();
    await applicationLease?.assertOwnership();
  };
  const measureStage = async <T>(stage: string, operation: () => Promise<T>) => {
    const startedAt = Date.now();
    try {
      if (stage === "database-write") await assertApplicationOwnership();
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
        Promise.resolve(options.onProgress?.({ ...result, total: products.length })),
      );
    } catch (error) {
      logger.warn("price-checker/run", "Price check progress callback failed", {
        errorMessage: getErrorMessage(error),
      });
    }
  };
  const reportProductComplete = async (productId: string) => {
    try {
      if (options.storeId) {
        try {
          await queueAmazonShippingHold(options.storeId, productId);
          if (products.find(product => product.id === productId)?.status === ProductStatus.ON_HOLD) await queuePriceCheckAutoResumeForProduct(options.storeId, productId);
        }
        catch (error) {
          logger.error("price-checker/shipping", "Could not queue the automatic shipping action; it will be retried on the next check", error, { productId, storeId: options.storeId });
        }
      }
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
                    total: products.length,
                  }),
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
      const startedAt = productStartedAt.get(productId);
      if (startedAt !== undefined) {
        timing.record("product-total", Date.now() - startedAt);
        productStartedAt.delete(productId);
      }
    }
  };
  const recordProductFailure = async (input: PriceCheckProductFailure & {
    observationId?: string | null; stockLeft?: number | null;
  }) => {
    const persisted = await measureStage("database-write", () =>
      prisma.product.updateMany({
        where: {
          id: input.productId,
          OR: [{ lastPriceCheck: null }, { lastPriceCheck: { lt: input.checkedAt } }],
        },
        data: {
          ...(input.observationId ? { lastPriceCheck: input.checkedAt } : {}),
          priceCheckError: input.message,
          priceCheckFailureCode: input.code,
          ...(input.observationId ? { holdLastObservationId: input.observationId } : {}),
          ...(input.stockLeft !== undefined ? getAmazonStockUpdate(input.stockLeft) : {}),
          ...(input.observationId ? {
            amazonAvailability: [PriceCheckFailureCode.AMAZON_OUT_OF_STOCK, PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE]
              .includes(input.code as "AMAZON_OUT_OF_STOCK") ? AmazonAvailability.OUT_OF_STOCK : AmazonAvailability.UNKNOWN,
          } : {}),
        },
      }),
    );
    result.failed += 1;
    if (!persisted.count) return;

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
  const finishResultWait = (error: PriceCheckResultDeferred) => {
    result.checked -= 1;
    runOutcome = "deferred";
    return { ...result, deferred: true, retryAt: new Date(Date.now() + 5_000).toISOString(),
      reason: error.message, waitReason: error.message, technicalFailureCode: "PRICE_CHECK_RESULT_WAIT" };
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

  let sharedBrowser: Browser | null = null;
  let deliveryPermit: DeliveryPermit | undefined;
  const getSharedBrowser = async () => {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      if (deliveryState && sharedBrowser) {
        resetAmazonDeliveryState(deliveryState);
        deliveryEvents.reset = (deliveryEvents.reset ?? 0) + 1;
        timing.increment("delivery-state-reset");
      }
      sharedBrowser = await launchScraperBrowser();
    }
    return sharedBrowser;
  };
  const closeSharedBrowser = async () => {
    if (deliveryState) {
      resetAmazonDeliveryState(deliveryState);
      deliveryEvents.reset = (deliveryEvents.reset ?? 0) + 1;
      timing.increment("delivery-state-reset");
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
    signal?: AbortSignal,
  ) => {
    const scrapeWithBrowser = async (allowDeliveryStateReuse: boolean) => {
      const browser = await getSharedBrowser();
      if (signal?.aborted) { await closeSharedBrowser(); signal.throwIfAborted(); }
      timing.increment("scrape-attempts");
      const sharedSnapshot = optimizationConfig.enabled.includes(
        "shared-snapshot",
      );
      return scrapeAmazonPrice(
        asin,
        browser,
        scrapePostcode,
        priceTrackingMode,
        variantHints,
      {
          allowDealPriceFallback: true,
          signal,
          onDeliverySetupDiagnostic: details => logger.info("price-checker/delivery-setup", "Amazon delivery setup attempt", {
            jobId: options.jobId, storeId: options.storeId, productId, asin,
            revision: process.env.LISTFLOW_REVISION ?? process.env.VERCEL_GIT_COMMIT_SHA, ...details }),
          ...(timing.enabled
            ? {
                onTiming: (stage: string, durationMs: number) =>
                  timing.record(stage, durationMs),
              }
            : {}),
          sharedSnapshot,
          deliveryState,
          allowDeliveryStateReuse,
          onDeliveryStateEvent: (event, detail) => {
            deliveryEvents[event] = (deliveryEvents[event] ?? 0) + 1;
            timing.increment(`delivery-state-${event}`);
            if (event === "disabled") {
              logger.warn("price-checker/delivery-state", "Postcode reuse disabled for the remaining run", {
                jobId: options.jobId,
                storeId: options.storeId,
                scrapePostcode,
                reason: detail?.reason ?? deliveryState?.disabledReason,
              });
            }
          },
        },
      );
    };

    try {
      const initial = await scrapeWithBrowser(true);
      if (initial.price === null || evaluateAmazonShipping(initial.shippingEvidence, supplierSettings.maxShippingDays).outcome !== "UNKNOWN" || shouldAbort() || signal?.aborted) return initial;
      await closeSharedBrowser();
      timing.increment("shipping-verification-retries");
      try { return await scrapeWithBrowser(false); }
      catch (error) {
        if (shouldAbort() || signal?.aborted) throw error;
        logger.warn("price-checker/shipping", "Fresh shipping verification failed; preserving the verified initial price", { productId, errorMessage: getErrorMessage(error) });
        return initial;
      }
    } catch (error) {
      timing.increment("scrape-retries");
      await closeSharedBrowser();

      if (shouldAbort() || signal?.aborted || (error instanceof AmazonDeliveryFailure && !error.permitsFreshContextRetry)) {
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
      signal?.throwIfAborted();
      if (shouldAbort()) throw error;

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
    for (const [index, initialProduct] of products.entries()) {
    if (await checkCancelled()) {
      return finishCancelled();
    }

    let product = initialProduct;
    result.checked += 1;
    productStartedAt.set(product.id, Date.now());

      let checkedAt = new Date();

      const prerequisiteIssue = getPriceCheckPrerequisiteIssue(product);

      if (prerequisiteIssue || !product.asin) {
        const skipReason = prerequisiteIssue === "missing-variants"
          ? "No variants found"
          : "Missing Amazon ASIN";

        result.skipped += 1;

        await measureStage("database-write", () => prisma.product.updateMany({
          where: { id: product.id, lastPriceCheck: null },
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
      const variantHints = extractVariantSelectionHints(product);

      if (simulatedAmazonPrice === null) {
        deliveryPermit = await acquireDeliveryPermit(product.storeId, options.jobId ?? `direct:${product.id}`, PRODUCT_CHECK_TIMEOUT_MS);
        if (deliveryPermit.wait) {
          result.checked -= 1;
          runOutcome = "deferred";
          return { ...result, ...deliveryPermit.wait, reason: deliveryPermit.wait.waitReason, deferred: true };
        }
      }

      let observationId: string | null = null;
      try {
        let currentAmazonPrice: number | null;
        let scrapedAmazonStockLeft: number | null | undefined;
        let scrapeResult: ScrapedAmazonPrice | undefined;

        if (simulatedAmazonPrice !== null) {
          currentAmazonPrice = simulatedAmazonPrice;
        } else {
          let scrapeTimedOut = false;
          const controller = new AbortController();
          let cancellationPollRunning = false;
          const cancelTimer = setInterval(() => {
            if (cancellationPollRunning || controller.signal.aborted) return;
            cancellationPollRunning = true;
            void (async () => {
              await options.assertOwnership?.();
              if (await checkCancelled()) controller.abort(new Error("Price check cancelled."));
            })().catch(error => controller.abort(error)).finally(() => { cancellationPollRunning = false; });
          }, 1000);
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
                controller.signal,
              ),
              PRODUCT_CHECK_TIMEOUT_MS,
              timeoutMessage,
            );
            controller.signal.throwIfAborted();
            await options.assertOwnership?.();
          } catch (error) {
            if (getErrorMessage(error) === timeoutMessage) {
              scrapeTimedOut = true;
              controller.abort(error);
              await closeSharedBrowser();
            }
            if (controller.signal.aborted && !scrapeTimedOut) throw controller.signal.reason;
            if (!(error instanceof AmazonDeliveryFailure) && getPriceCheckFailureCode(error) === PriceCheckFailureCode.TECHNICAL_ERROR &&
                !(error instanceof PriceCheckFailure && error.postcodeVerified)) {
              throw new AmazonDeliveryFailure(getErrorMessage(error), {
                technicalCode: "AMAZON_DELIVERY_PAGE_INVALID", stage: "navigation-or-extraction",
                requestedPostcode: scrapePostcode, browserError: getErrorMessage(error).slice(0, 300) });
            }
            throw error;
          } finally {
            clearInterval(cancelTimer);
          }

          if (!scrapeResult.postcodeVerified) {
            throw new AmazonDeliveryFailure("The final Amazon delivery postcode was not verified.", {
              technicalCode: "AMAZON_DELIVERY_POSTCODE_UNVERIFIED", stage: "final-verification",
              requestedPostcode: scrapePostcode,
            });
          }
          if (scrapeResult.identityOutcome !== "MATCH" || scrapeResult.detectedAsin !== product.asin) {
            const failure = new PriceCheckFailure(PriceCheckFailureCode.AMAZON_ASIN_REDIRECT,
              "The final Amazon page did not match the requested ASIN.", scrapeResult.detectedAsin);
            failure.postcodeVerified = true;
            throw failure;
          }
          if (scrapeResult.postcodeVerified && deliveryPermit) {
            await confirmAmazonDelivery(deliveryPermit);
            await releaseDeliveryPermit(deliveryPermit);
            deliveryPermit = undefined;
          }

          checkedAt = scrapeResult.observedAt ?? new Date();
          currentAmazonPrice = scrapeResult.price;
          scrapedAmazonStockLeft = scrapeResult.stockLeft;
        }

        if (simulatedAmazonPrice !== null) checkedAt = new Date();
        const observationFailureCode =
          scrapeResult?.buyBoxOutcome === "UNAVAILABLE"
            ? PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE
            : scrapeResult?.variantSelectionFailed
              ? PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED
              : currentAmazonPrice === null ? PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE : null;
        const amazonAvailabilityUpdate = getAmazonAvailabilityUpdate({
          price: currentAmazonPrice,
          stockLeft: scrapedAmazonStockLeft,
          failureCode: observationFailureCode,
          buyBoxOutcome: scrapeResult?.buyBoxOutcome,
          identityOutcome: scrapeResult?.identityOutcome,
        });
        if (options.storeId) {
          try {
            await options.assertOwnership?.();
            const observation = await prisma.amazonPriceObservation.create({
              data: {
                productId: product.id,
                storeId: options.storeId,
                requestedAsin: product.asin,
                selectedAsin: scrapeResult?.detectedAsin ?? null,
                identityOutcome: scrapeResult?.identityOutcome ?? "UNKNOWN",
                buyBoxOutcome: scrapeResult?.buyBoxOutcome ?? "UNKNOWN",
                postcodeVerified: scrapeResult?.postcodeVerified === true,
                verifiedPostcode: scrapeResult?.postcodeVerified
                  ? scrapePostcode
                  : null,
                acceptedPriceSource: scrapeResult?.acceptedPriceSource ?? null,
                availability: amazonAvailabilityUpdate.amazonAvailability,
                stockLeft: scrapedAmazonStockLeft ?? null,
                eligibleOffer:
                  currentAmazonPrice !== null &&
                  scrapeResult?.buyBoxOutcome !== "UNAVAILABLE" &&
                  scrapeResult?.identityOutcome !== "MISMATCH",
                price: currentAmazonPrice === null ? null : toMoneyDecimal(currentAmazonPrice),
                regularPrice: scrapeResult?.priceChoices?.regular == null
                  ? null
                  : toMoneyDecimal(scrapeResult.priceChoices.regular),
                dealPrice: scrapeResult?.priceChoices?.deal == null
                  ? null
                  : toMoneyDecimal(scrapeResult.priceChoices.deal),
                priceMode: scrapeResult?.selectedPriceMode ??
                  (currentAmazonPrice !== null ? priceTrackingMode : null),
                failureCode: observationFailureCode,
                message:
                  observationFailureCode === PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE
                    ? "The normal Amazon Buy Box is unavailable."
                    : scrapeResult?.variantSelectionReason ?? null,
                observedAt: checkedAt,
                shippingEvidence: scrapeResult?.shippingEvidence ?? undefined,
                isSuccessful:
                  currentAmazonPrice !== null &&
                  scrapeResult?.buyBoxOutcome !== "UNAVAILABLE" &&
                  scrapeResult?.identityOutcome !== "MISMATCH",
              },
            });
            observationId = observation.id;
          } catch (error) {
            logger.warn("price-checker/run", "Could not persist Amazon observation", {
              productId: product.id,
              errorMessage: getErrorMessage(error),
            });
            throw new PriceCheckResultDeferred("Could not persist the verified Amazon observation. Retrying; remaining products preserved.");
          }
        }

        applicationLease = await acquirePriceCheckResultLease({
          storeId: product.storeId, productId: product.id, worker: options.worker,
          assertOwnership: options.assertOwnership, shouldCancel: options.shouldCancel,
        });
        await assertApplicationOwnership();
        const refreshed = await prisma.product.findUnique({ where: { id: product.id },
          include: { store: true, variants: { orderBy: { createdAt: "asc" } } } });
        if (!refreshed || ![ProductStatus.IMPORTED, ProductStatus.ON_HOLD].includes(refreshed.status as "IMPORTED")) {
          result.skipped += 1;
          await reportProductComplete(product.id);
          continue;
        }
        if (normalizeAmazonPriceTrackingMode(refreshed.amazonPriceTrackingMode) !== priceTrackingMode) {
          // The observation belongs to the old preference. Never apply it to the new one.
          if (observationId) {
            await prisma.amazonPriceObservation.update({ where: { id: observationId },
              data: { isSuccessful: false, eligibleOffer: false, failureCode: null,
                message: "Tracking preference changed during this check; observation discarded." } });
          }
          result.skipped += 1;
          await reportProductComplete(product.id);
          continue;
        }
        product = refreshed;
        logger.info("price-checker/run", "Amazon tracking price selected", {
          productId: product.id, asin: product.asin, requestedMode: priceTrackingMode,
          selectedMode: scrapeResult?.selectedPriceMode ?? (currentAmazonPrice !== null ? priceTrackingMode : null),
          isFallback: priceTrackingMode === "DEAL" && scrapeResult?.selectedPriceMode === "REGULAR",
          price: currentAmazonPrice,
        });
        await assertAmazonObservationCurrent({ storeId: product.storeId, productId: product.id, observedAt: checkedAt });
        const acceptedObservation = product.holdLastObservationId ? await prisma.amazonPriceObservation.findUnique({
          where: { id: product.holdLastObservationId },
        }) : null;
        const acceptedAt = acceptedObservation?.observedAt ??
          (product.priceCheckFailureCode === PriceCheckFailureCode.TECHNICAL_ERROR ? null : product.lastPriceCheck);
        if (acceptedAt && acceptedAt >= checkedAt) throw new SupersededAmazonObservation();
        // Use the current settings and variant state, rather than the run-start snapshot.
        const refreshedSettings = await prisma.supplierSettings.findUnique({ where: {
          storeId_supplierName: { storeId: product.storeId, supplierName: SUPPLIER_NAME },
        } });
        if (refreshedSettings) Object.assign(supplierSettings, refreshedSettings);
        await measureStage("database-write", () => prisma.priceHistory.updateMany({
          where: { productId: product.id, appliedAt: null, createdAt: { lt: checkedAt } },
          data: { appliedAt: checkedAt, ebayRevised: false, status: "SUPERSEDED" },
        }));
        const amazonStockUpdate = getAmazonStockUpdate(scrapedAmazonStockLeft);
        const lowStockResolvedUpdate = getLowStockResolvedUpdate(
          product,
          scrapedAmazonStockLeft,
          supplierSettings.minProductQuantity,
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
                jobId: options.jobId,
                storeId: product.storeId,
                reason: scrapeResult.variantSelectionReason,
              }
            );

            await reportProductComplete(product.id);
            continue;
          }

          await recordProductFailure({
            productId: product.id,
            code: scrapeResult?.buyBoxOutcome === "UNAVAILABLE" ? PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE : PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
            message: scrapeResult?.buyBoxOutcome === "UNAVAILABLE"
              ? "The normal Amazon Buy Box is unavailable." : getAmazonPriceUnavailableMessage(priceTrackingMode),
            checkedAt, observationId, stockLeft: scrapedAmazonStockLeft,
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

        const guardedExternalWrite: NonNullable<RunPriceCheckOptions["withExternalWrite"]> = write =>
          runObservedPriceWrite({ storeId: product.storeId, productId: product.id, observedAt: checkedAt,
            observationKey: observationId ?? `${options.jobId ?? randomUUID()}:${checkedAt.toISOString()}`,
            assertOwnership: assertApplicationOwnership }, write);
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

          const persisted = await measureStage("database-write", () => prisma.$transaction(async (tx) => {
            const claim = await tx.product.updateMany({
              where: {
                id: product.id,
                lastPriceCheck: product.lastPriceCheck,
              },
              data: { lastPriceCheck: checkedAt },
            });
            if (!claim.count) return false;
            await tx.product.update({
              where: { id: product.id },
              data: {
                amazonPrice: currentAmazonPriceDecimal,
                ...amazonStockUpdate,
                ...amazonAvailabilityUpdate,
                ...(observationId ? { holdLastObservationId: observationId } : {}),
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
            return true;
          }));
          if (!persisted) {
            await reportProductComplete(product.id);
            continue;
          }

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
            checkedAt, observationId, stockLeft: scrapedAmazonStockLeft,
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

            await measureStage("database-write", () => prisma.product.updateMany({
              where: {
                id: product.id,
                lastPriceCheck: product.lastPriceCheck,
              },
              data: {
                amazonPrice: toMoneyDecimal(currentAmazonPrice),
                ...amazonStockUpdate,
                ...amazonAvailabilityUpdate,
                ...(observationId ? { holdLastObservationId: observationId } : {}),
                ...lowStockResolvedUpdate,
                lastPriceCheck: checkedAt,
                priceCheckError: null,
                priceCheckFailureCode: null,
              },
            }));

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

          const persisted = await measureStage("database-write", () => prisma.$transaction(async (tx) => {
            const claim = await tx.product.updateMany({
              where: {
                id: product.id,
                lastPriceCheck: product.lastPriceCheck,
              },
              data: { lastPriceCheck: checkedAt },
            });
            if (!claim.count) return false;
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
                ...amazonAvailabilityUpdate,
                ...(observationId ? { holdLastObservationId: observationId } : {}),
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
            return true;
          }));
          if (!persisted) {
            await reportProductComplete(product.id);
            continue;
          }

          result.changed += 1;
          const mismatchPrimarySellPrice =
            mismatchVariants[0]?.nextSellPrice;

          if (
            mismatchPrimarySellPrice !== undefined &&
            canAutomaticallyApplyTrackedPriceChange(product) &&
            shouldAutomaticallyApplyPriceChange(
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
                assertOwnership: assertApplicationOwnership,
                beforeExternalWrite: options.beforeExternalWrite,
                withExternalWrite: guardedExternalWrite,
                recordTiming: (stage, durationMs) => timing.record(stage, durationMs),
              });

            if (automaticApplication.success) {
              logger.info(
                "price-checker/run",
                "BuyPrice change applied automatically",
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
              if (!("deferred" in automaticApplication && automaticApplication.deferred)) result.failed += 1;

              logger.warn(
                "price-checker/run",
                ("deferred" in automaticApplication && automaticApplication.deferred) ? "Authorized price waiting for stock restoration" : "Automatic BuyPrice increase application failed; review retained",
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
          result.skipped += 1;
          await reportProductComplete(product.id);
          continue;
        }

        const persisted = await measureStage("database-write", () => prisma.$transaction(async (tx) => {
          const claim = await tx.product.updateMany({
            where: {
              id: product.id,
              lastPriceCheck: product.lastPriceCheck,
            },
            data: { lastPriceCheck: checkedAt },
          });
          if (!claim.count) return false;
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
              ...amazonAvailabilityUpdate,
              ...(observationId ? { holdLastObservationId: observationId } : {}),
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
          return true;
        }));
        if (!persisted) {
          await reportProductComplete(product.id);
          continue;
        }

        result.changed += 1;

        if (
          canAutomaticallyApplyTrackedPriceChange(product) &&
          shouldAutomaticallyApplyPriceChange(
            previousAmazonPrice,
            currentAmazonPrice,
          )
        ) {
          const automaticApplication = await automaticallyApplyPriceIncrease({
            product,
            variants: nextVariants,
            nextPrimarySellPrice,
            checkedAt,
            assertOwnership: assertApplicationOwnership,
            beforeExternalWrite: options.beforeExternalWrite,
            withExternalWrite: guardedExternalWrite,
            recordTiming: (stage, durationMs) => timing.record(stage, durationMs),
          });

          if (automaticApplication.success) {
            logger.info(
              "price-checker/run",
              "Tracked price change applied automatically",
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
              if (!("deferred" in automaticApplication && automaticApplication.deferred)) result.failed += 1;

            logger.warn(
              "price-checker/run",
              ("deferred" in automaticApplication && automaticApplication.deferred) ? "Authorized price waiting for stock restoration" : "Automatic price increase application failed; review retained",
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
        if (error instanceof PriceCheckResultDeferred) return finishResultWait(error);
        if (error instanceof SupersededAmazonObservation) {
          result.skipped += 1;
          logger.info("price-checker/run", "Older Amazon observation preserved without applying", {
            productId: product.id, jobId: options.jobId, observedAt: checkedAt.toISOString(),
          });
          await reportProductComplete(product.id);
          continue;
        }
        if (await checkCancelled()) {
          result.checked -= 1;
          return finishCancelled();
        }
        const rawMessage = getErrorMessage(error);
        const message = error instanceof AmazonDeliveryFailure
          ? `[${error.details.technicalCode}] ${rawMessage}` : getBrowserLaunchUserMessage(error) ?? rawMessage;
        await options.assertOwnership?.();
        const code = getPriceCheckFailureCode(error);
        checkedAt = error instanceof PriceCheckFailure && error.observedAt ? error.observedAt : checkedAt;

        if (options.storeId) {
          try {
            await options.assertOwnership?.();
            const failedObservation = await prisma.amazonPriceObservation.create({
              data: {
                productId: product.id,
                storeId: options.storeId,
                requestedAsin: product.asin,
                selectedAsin:
                  error instanceof PriceCheckFailure ? (error.identityVerified ? product.asin : error.detectedAsin) : null,
                identityOutcome:
                  code === PriceCheckFailureCode.AMAZON_ASIN_REDIRECT
                    ? "MISMATCH"
                    : error instanceof PriceCheckFailure && error.identityVerified ? "MATCH" : "UNKNOWN",
                buyBoxOutcome:
                  [PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE, PriceCheckFailureCode.AMAZON_OUT_OF_STOCK].includes(code as "AMAZON_OUT_OF_STOCK")
                    ? "UNAVAILABLE"
                    : "UNKNOWN",
                observedAt: checkedAt,
                availability: error instanceof PriceCheckFailure && error.identityVerified &&
                  (code === PriceCheckFailureCode.AMAZON_OUT_OF_STOCK || code === PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE)
                    ? AmazonAvailability.OUT_OF_STOCK : AmazonAvailability.UNKNOWN,
                stockLeft: error instanceof PriceCheckFailure && error.identityVerified &&
                  (code === PriceCheckFailureCode.AMAZON_OUT_OF_STOCK || code === PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE) ? 0 : null,
                eligibleOffer: false,
                priceMode: priceTrackingMode,
                failureCode: code,
                message,
                isSuccessful: false,
                postcodeVerified: error instanceof PriceCheckFailure && error.postcodeVerified,
                verifiedPostcode: error instanceof PriceCheckFailure && error.postcodeVerified ? scrapePostcode : null,
              },
            });
            observationId = failedObservation.id;
          } catch (observationError) {
            logger.warn("price-checker/run", "Could not persist failed Amazon observation", {
              productId: product.id,
              errorMessage: getErrorMessage(observationError),
            });
          }
        }

        if (error instanceof AmazonDeliveryFailure && deliveryPermit && shouldDeferAmazonDeliveryFailure(error)) {
          result.checked -= 1;
          runOutcome = "deferred";
          const waiting = await deferAmazonDelivery(deliveryPermit, error.details.technicalCode);
          logger.warn("price-checker/delivery-cooldown", "Amazon delivery setup deferred; product remains unfinished", {
            storeId: product.storeId, jobId: options.jobId, productId: product.id, asin: product.asin,
            revision: process.env.LISTFLOW_REVISION ?? process.env.VERCEL_GIT_COMMIT_SHA,
            ...error.details, ...waiting });
          return { ...result, ...waiting, reason: waiting.waitReason, deferred: true };
        }
        if (error instanceof PriceCheckFailure && error.postcodeVerified && deliveryPermit) {
          await confirmAmazonDelivery(deliveryPermit);
        }

        if (!applicationLease) {
          try {
            applicationLease = await acquirePriceCheckResultLease({
              storeId: product.storeId, productId: product.id, worker: options.worker,
              assertOwnership: options.assertOwnership, shouldCancel: options.shouldCancel,
            });
          } catch (leaseError) {
            if (leaseError instanceof PriceCheckResultDeferred) return finishResultWait(leaseError);
            throw leaseError;
          }
        }
        const refreshed = await prisma.product.findUnique({ where: { id: product.id },
          include: { store: true, variants: true } });
        if (refreshed) product = refreshed;
        if (product.lastPriceCheck && product.lastPriceCheck >= checkedAt) {
          result.skipped += 1;
        } else {
          await assertApplicationOwnership();
          const newer = await prisma.amazonPriceObservation.findFirst({ where: {
            storeId: product.storeId, productId: product.id, observedAt: { gt: checkedAt },
            identityOutcome: "MATCH", postcodeVerified: true,
            OR: [{ isSuccessful: true }, { buyBoxOutcome: "UNAVAILABLE" }],
          } });
          if (newer) result.skipped += 1;
          else await recordProductFailure({ productId: product.id, code, message, checkedAt,
            observationId: error instanceof PriceCheckFailure && error.identityVerified ? observationId : undefined,
            stockLeft: error instanceof PriceCheckFailure && error.identityVerified && error.postcodeVerified &&
              (code === PriceCheckFailureCode.AMAZON_OUT_OF_STOCK || code === PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE) ? 0 : undefined,
          });
        }

        logger.error("price-checker/run", "Price check failed", error, {
          productId: product.id,
          asin: product.asin,
          failureCode: code,
        });
      } finally {
        if (deliveryPermit) { await releaseDeliveryPermit(deliveryPermit); deliveryPermit = undefined; }
        if (applicationLease) {
          await applicationLease.release();
          applicationLease = undefined;
        }
      }

      if (deliveryPermit) { await releaseDeliveryPermit(deliveryPermit); deliveryPermit = undefined; }

      await reportProductComplete(product.id);

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
    if (deliveryPermit) await releaseDeliveryPermit(deliveryPermit);
    await closeSharedBrowser();
    invalidateRunCaches();
    if (deliveryState) {
      logger.info("price-checker/delivery-state", "Postcode session reuse summary", {
        jobId: options.jobId,
        storeId: options.storeId,
        scrapePostcode,
        outcome: runOutcome,
        optimizations: optimizationConfig.enabled,
        events: deliveryEvents,
        disabled: deliveryState.disabled,
        disabledReason: deliveryState.disabledReason,
      });
    }
    if (timing.enabled) {
      logger.info("price-checker/timing", "Price check timing summary", {
        jobId: options.jobId,
        storeId: options.storeId,
        scrapePostcode,
        outcome: runOutcome,
        optimizations: optimizationConfig.enabled,
        result,
        timing: timing.snapshot(),
      });
    }
  }

  return result;
}
