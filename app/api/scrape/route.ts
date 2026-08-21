import { auth } from "@/auth";
import { NextResponse } from "next/server";
import {
  AmazonDirectScrapeError,
  scrapeAmazonProductDirect,
  type AmazonScrapeStage,
} from "@/lib/amazon-direct-scraper";
import { getEbaySuggestedCategories, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getStorePolicyDefaults } from "@/lib/policy-defaults";
import { normalizeItemSpecifics } from "@/lib/item-specifics";
import {
  isAmazonPriceTrackingMode,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { extractAmazonAsinFromValue } from "@/lib/amazon-direct-scraper";
import {
  findExistingAmazonProduct,
  getDuplicateAmazonProductBody,
} from "@/lib/product-duplicate";

export const maxDuration = 60;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("scrape/route", "Unauthorized scrape attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("scrape/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url } = body;
  const allowMetadataOnly = body?.mode === "regrab";
  const discoverAllPriceChoices = body?.mode === "advanced";
  const priceTrackingMode = isAmazonPriceTrackingMode(
    body?.amazonPriceTrackingMode
  )
    ? body.amazonPriceTrackingMode
    : undefined;

  if (!url || typeof url !== "string" || url.trim() === "") {
    log.warn("scrape/route", "Scrape request missing URL");
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (!url.startsWith("https://www.amazon.com.au")) {
    log.warn("scrape/route", "Rejected non-Amazon-AU scrape URL", { url });
    return NextResponse.json(
      { error: "Only Amazon AU URLs are supported" },
      { status: 400 },
    );
  }

  log.info("scrape/route", "Scrape started", { url });

  try {
    const requestedAsin = extractAmazonAsinFromValue(url);
    const existingProduct = await findExistingAmazonProduct(
      storeSession.storeId,
      requestedAsin,
      prisma,
    );

    if (existingProduct && !allowMetadataOnly) {
      log.info("scrape/route", "Duplicate Amazon product rejected", {
        asin: requestedAsin,
        existingProductId: existingProduct.id,
        existingStatus: existingProduct.status,
      });
      return NextResponse.json(
        getDuplicateAmazonProductBody(existingProduct),
        { status: 409 },
      );
    }

    const supplierSettings = await prisma.supplierSettings.findFirst({
      where: { supplierName: "Amazon AU", storeId: storeSession.storeId },
    });

    const logStage = (
      stage: AmazonScrapeStage,
      durationMs: number,
      metadata: Record<string, unknown> = {}
    ) => {
      log.info("scrape/route", "Scrape stage completed", {
        stage,
        durationMs,
        ...metadata,
      });
    };

    const resolveRenderedAmazonPrices = async (
      asin: string,
      postcode: string,
      requestedPriceMode: AmazonPriceTrackingMode,
    ) => {
      log.info(
        "scrape/route",
        "Direct buybox price choice missing; starting rendered Amazon fallback",
        {
          asin,
          postcode,
          priceTrackingMode: requestedPriceMode,
          discoverAllPriceChoices,
        },
      );

      const { scrapeAmazonPrice } = await import("@/lib/amazon-scraper");
      const result = await withTimeout(
        scrapeAmazonPrice(
          asin,
          undefined,
          postcode,
          requestedPriceMode,
        ),
        40_000,
        "Rendered Amazon price lookup timed out",
      );

      log.info("scrape/route", "Rendered Amazon fallback completed", {
        asin,
        price: result.price,
        priceChoices: result.priceChoices,
        priceTrackingMode: requestedPriceMode,
      });

      return result;
    };

    const product = await scrapeAmazonProductDirect(url, {
      allowMetadataOnly,
      discoverAllPriceChoices,
      onStage: logStage,
      priceTrackingMode,
      postcode:
        supplierSettings?.scrapePostcode?.trim() ||
        supplierSettings?.defaultZipcode?.trim() ||
        "2217",
      resolveMissingPriceChoices: discoverAllPriceChoices
        ? async ({ asin, postcode }) => {
            const result = await resolveRenderedAmazonPrices(
              asin,
              postcode,
              "REGULAR",
            );

            return {
              regular:
                result.priceChoices?.regular ??
                (result.priceMode === "REGULAR" ? result.price : null),
              deal:
                result.priceChoices?.deal ??
                (result.priceMode === "DEAL" ? result.price : null),
            };
          }
        : undefined,
      resolveMissingPrice: discoverAllPriceChoices
        ? undefined
        : async ({ asin, postcode, priceTrackingMode: requestedPriceMode }) => {
            const result = await resolveRenderedAmazonPrices(
              asin,
              postcode,
              requestedPriceMode,
            );
            return result.price;
          },
    });

    if (!allowMetadataOnly && (product.price === null || product.price <= 0)) {
      log.warn("scrape/route", "Scrape did not find a valid Amazon price", {
        url,
        asin: product.asin,
        title: product.title,
      });
      return NextResponse.json(
        {
          error:
            "Amazon product was found, but ListFlow could not read a valid price. Open the Amazon page, confirm the selected variation has a price, then try again.",
        },
        { status: 422 }
      );
    }

    log.info("scrape/route", "Scrape succeeded", {
      url,
      asin: product.asin,
      title: product.title,
      imageCount: product.images.length,
      amazonPriceTrackingMode: product.amazonPriceTrackingMode,
    });

    let categoryId = "";
    let categoryName = "";
    const categoryStartedAt = Date.now();

    try {
      let storeNumber: 1 | 2 | 3 = 1;
      try {
        storeNumber = await getStoreNumber(storeSession.storeId);
      } catch {
        storeNumber = (supplierSettings?.storeNumber as 1 | 2 | 3) ?? 1;
      }

      const suggestions = await withTimeout(
        getEbaySuggestedCategories(product.title, storeNumber),
        15000,
        "eBay category detection timed out"
      );
      logStage("category_suggest", Date.now() - categoryStartedAt, {
        totalSuggestions: suggestions.length,
      });
      if (suggestions.length > 0) {
        categoryId = suggestions[0].categoryId;
        categoryName = suggestions[0].categoryName;
        log.info("scrape/route", "Auto-detected eBay category", {
          categoryId,
          categoryName,
          totalSuggestions: suggestions.length,
        });
      }
    } catch (error) {
      logStage("category_suggest", Date.now() - categoryStartedAt, {
        failed: true,
        reason: error instanceof Error ? error.message : "unknown",
      });
      log.error("scrape/route", "Category detection failed (non-blocking)", undefined, {
        title: product.title,
      });
    }

    const policyDefaults = await getStorePolicyDefaults(storeSession.storeId);
    const supplierDefaults = {
      quantity: supplierSettings?.defaultQuantity ?? 1,
      country: supplierSettings?.defaultCountry ?? "Australia",
      zipcode: supplierSettings?.defaultZipcode ?? "3170",
      shippingMethod: supplierSettings?.defaultShippingMethod ?? "Cheapest with tracking",
      storeNumber: supplierSettings?.storeNumber ?? 1,
      shippingPolicyId: policyDefaults.shippingPolicyId,
      paymentPolicyId: policyDefaults.paymentPolicyId,
      returnPolicyId: policyDefaults.returnPolicyId,
      policyTemplateId: policyDefaults.policyTemplateId,
      capitalizeTitle: supplierSettings?.capitalizeTitle ?? false,
      defaultItemSpecifics: normalizeItemSpecifics(
        supplierSettings?.defaultItemSpecifics
      ),
    };

    logStage("draft_ready", 0, {
      asin: product.asin,
      title: product.title,
      price: product.price,
      amazonPriceTrackingMode: product.amazonPriceTrackingMode,
      availableAmazonPriceModes: Object.entries(product.priceChoices ?? {})
        .filter(([, choice]) => choice)
        .map(([mode]) => mode),
      imageCount: product.images.length,
    });

    return NextResponse.json({
      ...product,
      categoryId,
      categoryName,
      supplierDefaults,
    });
  } catch (error) {
    log.error("scrape/route", "Scrape failed", error, { url });

    if (error instanceof AmazonDirectScrapeError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : "Scraping failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
