import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { scrapeAmazonProduct } from "@/lib/amazon-scraper";
import { getEbaySuggestedCategories } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
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
    const supplierSettings = await prisma.supplierSettings.findFirst({
      where: { supplierName: "Amazon AU" },
    });

    const product = await scrapeAmazonProduct(
      url,
      supplierSettings?.scrapePostcode || undefined
    );

    log.info("scrape/route", "Scrape succeeded", {
      url,
      asin: product.asin,
      title: product.title,
      imageCount: product.images.length,
    });

    let categoryId = "";
    let categoryName = "";

    try {
      const suggestions = await getEbaySuggestedCategories(product.title, 1);
      if (suggestions.length > 0) {
        categoryId = suggestions[0].categoryId;
        categoryName = suggestions[0].categoryName;
        log.info("scrape/route", "Auto-detected eBay category", {
          categoryId,
          categoryName,
          totalSuggestions: suggestions.length,
        });
      }
    } catch {
      log.error("scrape/route", "Category detection failed (non-blocking)", undefined, {
        title: product.title,
      });
    }

    const supplierDefaults = {
      quantity: supplierSettings?.defaultQuantity ?? 1,
      country: supplierSettings?.defaultCountry ?? "Australia",
      zipcode: supplierSettings?.defaultZipcode ?? "3170",
      shippingMethod: supplierSettings?.defaultShippingMethod ?? "Cheapest with tracking",
      storeNumber: supplierSettings?.storeNumber ?? 1,
      templateId: supplierSettings?.defaultTemplateId ?? null,
      shippingPolicyId: supplierSettings?.defaultShippingPolicyId ?? null,
      paymentPolicyId: supplierSettings?.defaultPaymentPolicyId ?? null,
      returnPolicyId: supplierSettings?.defaultReturnPolicyId ?? null,
      capitalizeTitle: supplierSettings?.capitalizeTitle ?? false,
    };

    return NextResponse.json({
      ...product,
      categoryId,
      categoryName,
      supplierDefaults,
    });
  } catch (error) {
    log.error("scrape/route", "Scrape failed", error, { url });

    const message =
      error instanceof Error ? error.message : "Scraping failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
