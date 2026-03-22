import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { scrapeAmazonProduct } from "@/lib/amazon-scraper";
import { getEbaySuggestedCategories } from "@/lib/ebay";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (!url.startsWith("https://www.amazon.com.au")) {
    return NextResponse.json(
      { error: "Only Amazon AU URLs are supported" },
      { status: 400 }
    );
  }

  logger.info("scrape/route", "Scrape started", { url, userId: session.user.id });

  try {
    const product = await scrapeAmazonProduct(url);

    logger.info("scrape/route", "Scrape succeeded", {
      url,
      asin: product.asin,
      title: product.title,
      imageCount: product.images.length,
    });

    // Auto-detect eBay category from the product title
    let categoryId = "";
    let categoryName = "";
    try {
      const suggestions = await getEbaySuggestedCategories(product.title, 1);
      if (suggestions.length > 0) {
        categoryId = suggestions[0].categoryId;
        categoryName = suggestions[0].categoryName;
        logger.info("scrape/route", "Auto-detected eBay category", {
          categoryId,
          categoryName,
          totalSuggestions: suggestions.length,
        });
      }
    } catch {
      logger.error("scrape/route", "Category detection failed (non-blocking)", undefined, { title: product.title });
    }

    return NextResponse.json({
      ...product,
      categoryId,
      categoryName,
    });
  } catch (err) {
    logger.error("scrape/route", "Scrape failed", err, { url });

    const message =
      err instanceof Error ? err.message : "Scraping failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
