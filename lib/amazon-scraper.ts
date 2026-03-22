import { chromium } from "playwright";

export interface ScrapedProduct {
  title: string;
  description: string;
  images: string[];
  price: null; // always null — user sets price manually
  condition: "New"; // Amazon products are always new
  category: string;
  categoryId: string;
  categoryName: string;
  itemSpecifics: Record<string, string>;
  variantName: string | null;
  asin: string;
  brand: string;
}

export async function scrapeAmazonProduct(url: string): Promise<ScrapedProduct> {
  // Validate URL
  if (!url.includes("amazon.com.au")) {
    throw new Error("Only Amazon AU (amazon.com.au) URLs are supported.");
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#productTitle", { timeout: 15000 });

    // Title
    const title = await page.$eval(
      "#productTitle",
      (el) => el.textContent?.trim() ?? ""
    );

    // Images — extract all unique full-size image URLs
    const images = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        const match = script.textContent?.match(
          /'colorImages':\s*\{[^}]*'initial':\s*(\[[\s\S]*?\])\s*\}/
        );
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            return parsed
              .map(
                (img: { hiRes?: string; large?: string; main?: Record<string, string> }) =>
                  img.hiRes || img.large || (typeof img.main === "string" ? img.main : "")
              )
              .filter((u: string) => u && u.startsWith("https"));
          } catch {
            continue;
          }
        }
      }
      // Fallback: grab from thumbnail strip
      const thumbs = Array.from(document.querySelectorAll("#altImages img"));
      return thumbs
        .map((img) =>
          (img as HTMLImageElement).src
            .replace(/\._[A-Z]{2}\d+_\./, ".")
            .replace(/\._.*?_\./, ".")
        )
        .filter(
          (u) => u.includes("amazon") && !u.includes("play-button")
        );
    });

    // Price — always null
    const price = null;

    // Active variant
    const variantName = await page
      .$eval(
        ".selection, .a-button-selected .a-button-text, #variation_size_name .selection, #variation_style_name .selection",
        (el) => el.textContent?.trim() ?? null
      )
      .catch(() => null);

    // ASIN
    const asin = await page
      .$eval(
        'input[name="ASIN"], #ASIN',
        (el) => (el as HTMLInputElement).value
      )
      .catch(() => {
        const match = url.match(/\/dp\/([A-Z0-9]{10})/);
        return match ? match[1] : "";
      });

    // Brand
    const brand = await page
      .$eval("#bylineInfo, .po-brand .po-break-word", (el) =>
        el.textContent
          ?.replace("Brand:", "")
          .replace("Visit the", "")
          .replace("Store", "")
          .trim() ?? ""
      )
      .catch(() => "");

    // Category — last breadcrumb
    const category = await page
      .$eval(
        "#wayfinding-breadcrumbs_container ul li:last-child",
        (el) => el.textContent?.trim() ?? "General"
      )
      .catch(() => "General");

    // Description — extract full product description HTML
    const description = await page.evaluate(() => {
      const featureBullets = document.querySelector("#feature-bullets");
      const productDescription = document.querySelector("#productDescription");
      const aplus = document.querySelector("#aplus, #aplus_feature_div");

      let html = "";
      if (featureBullets) html += featureBullets.outerHTML;
      if (productDescription) html += productDescription.outerHTML;
      if (aplus) html += aplus.outerHTML;
      return html;
    });

    // Item Specifics — extract from product information table
    const itemSpecifics = await page.evaluate(() => {
      const specs: Record<string, string> = {};
      const rows = document.querySelectorAll(
        "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .a-keyvalue tr"
      );
      rows.forEach((row) => {
        const key = row.querySelector("th")?.textContent?.trim();
        const value = row.querySelector("td")?.textContent?.trim();
        if (
          key &&
          value &&
          !key.includes("Customer") &&
          !key.includes("Best Seller")
        ) {
          specs[key] = value.replace(/\u200e/g, "").trim();
        }
      });
      return specs;
    });

    return {
      title,
      description,
      images,
      price,
      condition: "New",
      category,
      categoryId: "",
      categoryName: "",
      itemSpecifics,
      variantName,
      asin,
      brand,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("amazon.com.au")) {
      throw err;
    }
    throw new Error(
      "Could not load Amazon product page. Please check the URL and try again."
    );
  } finally {
    await browser.close();
  }
}
