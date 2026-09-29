import "server-only";

import {
  AmazonDirectScrapeError,
  scrapeAmazonProductDirect,
  type AmazonScrapeStage,
} from "@/lib/amazon-direct-scraper";
import {
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { getEbaySuggestedCategories, getStoreNumber } from "@/lib/ebay";
import { normalizeItemSpecifics } from "@/lib/item-specifics";
import { getStorePolicyDefaults } from "@/lib/policy-defaults";
import { prisma } from "@/lib/prisma";
import { resolveAmazonDeliveryPostcode } from "@/lib/amazon-delivery-postcode";
import { validateAmazonImportResult } from "@/lib/amazon-import-page";

export type AmazonImportExecutionMode = "normal" | "advanced" | "regrab";

type AmazonImportLogger = {
  info(context: string, message: string, data?: unknown): unknown;
  warn(context: string, message: string, data?: unknown): unknown;
  error(context: string, message: string, error?: unknown, data?: unknown): unknown;
};

type AmazonImportProgress = (
  stage: AmazonScrapeStage | "scrape_started",
  progress: number,
) => void;

type ExecuteAmazonImportInput = {
  storeId: string;
  url: string;
  mode: AmazonImportExecutionMode;
  priceTrackingMode?: AmazonPriceTrackingMode;
  log: AmazonImportLogger;
  onProgress?: AmazonImportProgress;
};

const STAGE_PROGRESS: Record<AmazonScrapeStage, number> = {
  page_fetch: 25,
  html_parse: 40,
  postcode_set: 58,
  rendered_recovery: 65,
  price_extract: 76,
  category_suggest: 88,
  draft_ready: 96,
};

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error(message)); }, timeoutMs);
  });
  const work = Promise.resolve().then(() => operation(controller.signal));

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (controller.signal.aborted) {
      await Promise.race([
        work.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
    }
  }
}

export async function executeAmazonImport({
  storeId,
  url,
  mode,
  priceTrackingMode,
  log,
  onProgress,
}: ExecuteAmazonImportInput) {
  const allowMetadataOnly = mode === "regrab";
  const discoverAllPriceChoices = mode === "advanced";
  const [supplierSettings, policyDefaults] = await Promise.all([
    prisma.supplierSettings.findFirst({ where: { supplierName: "Amazon AU", storeId } }),
    getStorePolicyDefaults(storeId),
  ]);

  onProgress?.("scrape_started", 12);

  const logStage = (
    stage: AmazonScrapeStage,
    durationMs: number,
    metadata: Record<string, unknown> = {},
  ) => {
    log.info("amazon-import", "Scrape stage completed", {
      stage,
      durationMs,
      ...metadata,
    });
    onProgress?.(stage, STAGE_PROGRESS[stage]);
  };

  const resolveRenderedAmazonPrices = async (
    asin: string,
    postcode: string,
    requestedPriceMode: AmazonPriceTrackingMode,
  ) => {
    log.info(
      "amazon-import",
      "Direct buybox price missing; starting rendered Amazon fallback",
      { asin, postcode, priceTrackingMode: requestedPriceMode },
    );

    const { scrapeAmazonPrice } = await import("@/lib/amazon-scraper");
    const reuseBrowser = process.env.LISTFLOW_AMAZON_IMPORT_BROWSER_REUSE_ENABLED === "true";
    const lease = reuseBrowser
      ? await (await import("@/lib/amazon-import-browser-manager")).acquireImportBrowser(storeId, postcode)
      : null;
    const fallbackStartedAt = Date.now();
    const result = await withTimeout(
      async (signal) => {
        const discardOnAbort = () => { void lease?.release(true); };
        signal.addEventListener("abort", discardOnAbort, { once: true });
        try {
          return await scrapeAmazonPrice(asin, lease?.browser, postcode, requestedPriceMode, undefined, {
            captureImportPage: true,
            signal,
            deliveryState: lease?.deliveryState,
            onTiming: (stage, durationMs) => log.info("amazon-import", "Rendered recovery stage", { stage, durationMs, asin }),
          });
        } finally {
          signal.removeEventListener("abort", discardOnAbort);
          await lease?.release(signal.aborted);
        }
      },
      40_000,
      "Rendered Amazon price lookup timed out",
    );

    log.info("amazon-import", "Rendered Amazon fallback completed", {
      asin,
      price: result.price,
      priceChoices: result.priceChoices,
      priceTrackingMode: requestedPriceMode,
      durationMs: Date.now() - fallbackStartedAt,
      browserReused: reuseBrowser,
    });
    return result;
  };

  const product = await scrapeAmazonProductDirect(url, {
    allowMetadataOnly,
    discoverAllPriceChoices,
    onStage: logStage,
    priceTrackingMode,
    postcode: resolveAmazonDeliveryPostcode(supplierSettings?.scrapePostcode),
    resolveMissingPriceChoices: discoverAllPriceChoices
      ? async ({ asin, postcode }) => {
          const result = await resolveRenderedAmazonPrices(
            asin,
            postcode,
            "REGULAR",
          );
          return result;
        }
      : undefined,
    resolveMissingPrice: discoverAllPriceChoices
      ? undefined
      : async ({ asin, postcode, priceTrackingMode: requestedMode }) => {
          const result = await resolveRenderedAmazonPrices(
            asin,
            postcode,
            requestedMode,
          );
          return result;
        },
  });

  const metadataFailure = validateAmazonImportResult(product);
  if (metadataFailure) throw new AmazonDirectScrapeError(metadataFailure.message, 422, metadataFailure.code);

  if (!allowMetadataOnly && (product.price === null || product.price <= 0)) {
    log.warn("amazon-import", "Scrape did not find a valid Amazon price", {
      url,
      asin: product.asin,
      title: product.title,
    });
    throw new AmazonDirectScrapeError(
      "Amazon product was found, but ListFlow could not read the selected variant buybox price after checking delivery location. No draft was created.",
      422,
      "AMAZON_BUYBOX_PRICE_MISSING",
    );
  }

  let categoryId = "";
  let categoryName = "";
  const categoryStartedAt = Date.now();

  try {
    let storeNumber: 1 | 2 | 3 = 1;
    try {
      storeNumber = await getStoreNumber(storeId);
    } catch {
      storeNumber = (supplierSettings?.storeNumber as 1 | 2 | 3) ?? 1;
    }

    const suggestions = await withTimeout(
      (signal) => getEbaySuggestedCategories(product.title, storeNumber, product.category, signal),
      15_000,
      "eBay category detection timed out",
    );
    logStage("category_suggest", Date.now() - categoryStartedAt, {
      totalSuggestions: suggestions.length,
    });
    if (suggestions.length > 0) {
      const picked = suggestions[0];
      categoryId = picked.categoryId;
      categoryName = picked.categoryName;
    }
  } catch (error) {
    logStage("category_suggest", Date.now() - categoryStartedAt, {
      failed: true,
      reason: error instanceof Error ? error.message : "unknown",
    });
    log.error(
      "amazon-import",
      "Category detection failed (non-blocking)",
      error,
      { title: product.title },
    );
  }

  const supplierDefaults = {
    quantity: supplierSettings?.defaultQuantity ?? 1,
    country: supplierSettings?.defaultCountry ?? "Australia",
    zipcode: supplierSettings?.defaultZipcode ?? "3170",
    locationText: supplierSettings?.defaultLocationText ?? null,
    shippingMethod:
      supplierSettings?.defaultShippingMethod ?? "Cheapest with tracking",
    storeNumber: supplierSettings?.storeNumber ?? 1,
    shippingPolicyId: policyDefaults.shippingPolicyId,
    paymentPolicyId: policyDefaults.paymentPolicyId,
    returnPolicyId: policyDefaults.returnPolicyId,
    policyTemplateId: policyDefaults.policyTemplateId,
    capitalizeTitle: supplierSettings?.capitalizeTitle ?? false,
    defaultItemSpecifics: normalizeItemSpecifics(
      supplierSettings?.defaultItemSpecifics,
    ),
  };

  logStage("draft_ready", 0, {
    asin: product.asin,
    title: product.title,
    price: product.price,
    amazonPriceTrackingMode: product.amazonPriceTrackingMode,
    availableAmazonPriceModes: Object.entries(product.priceChoices ?? {})
      .filter(([, choice]) => choice)
      .map(([availableMode]) => availableMode),
    imageCount: product.images.length,
  });

  return {
    ...product,
    categoryId,
    categoryName,
    supplierDefaults,
  };
}
