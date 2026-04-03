import { chromium, type Browser } from "playwright";

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
  supplierDefaults?: {
    quantity: number;
    country: string;
    zipcode: string;
    shippingMethod: string;
    storeNumber: number;
    templateId: string | null;
    shippingPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
    capitalizeTitle: boolean;
  };
}

function parseAmazonPriceValue(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d.,]/g, "").trim();

  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/,/g, "");
  const parsed = Number.parseFloat(compact);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

export async function scrapeAmazonPrice(
  asin: string,
  browser?: Browser
): Promise<number | null> {
  const normalizedAsin = asin.trim().toUpperCase();

  if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) {
    throw new Error("A valid ASIN is required.");
  }

  const ownedBrowser = browser ?? (await chromium.launch({ headless: true }));
  const page = await ownedBrowser.newPage();

  try {
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    await page.goto(`https://www.amazon.com.au/dp/${normalizedAsin}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const selectors = [
      "#priceblock_ourprice",
      ".a-price .a-offscreen",
      "#price_inside_buybox",
      'span.a-price[data-a-color="price"] .a-offscreen',
    ];

    for (const selector of selectors) {
      const priceText = await page
        .locator(selector)
        .first()
        .textContent({ timeout: 5000 })
        .catch(() => null);
      const price = parseAmazonPriceValue(priceText);

      if (price !== null) {
        return price;
      }
    }

    const fallbackText = await page.evaluate(() => {
      const candidates = [
        document.querySelector("#corePrice_feature_div"),
        document.querySelector("#apex_desktop"),
        document.querySelector("#buybox"),
      ];

      for (const candidate of candidates) {
        const text = candidate?.textContent?.trim();
        if (text) {
          return text;
        }
      }

      return null;
    });

    return parseAmazonPriceValue(fallbackText);
  } finally {
    await page.close();

    if (!browser) {
      await ownedBrowser.close();
    }
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}=(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? match[2] : null;
}

function extractDescriptionImageUrl(tag: string): string | null {
  const directAttributes = ["src", "data-old-hires", "data-src"];

  for (const attribute of directAttributes) {
    const value = extractAttribute(tag, attribute);
    if (!value) continue;

    const decoded = decodeHtmlAttribute(value.trim());
    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }
  }

  const dynamicImage = extractAttribute(tag, "data-a-dynamic-image");
  if (!dynamicImage) return null;

  const decoded = decodeHtmlAttribute(dynamicImage);
  const match = decoded.match(/https?:\/\/[^"'}\],\s]+/i);
  return match ? match[0] : null;
}

function replaceDescriptionImagesWithTokens(html: string): {
  html: string;
  images: string[];
} {
  const images: string[] = [];

  const tokenizedHtml = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = extractDescriptionImageUrl(tag);
    if (!src || /play-button|spinner|loading|transparent|pixel/i.test(src)) {
      return "";
    }

    const alt = decodeHtmlAttribute(extractAttribute(tag, "alt") ?? "");
    const imageTag = `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" style="max-width:100%;height:auto;display:block;margin:12px auto;" />`;
    const token = `__LISTFLOW_DESC_IMAGE_${images.length}__`;
    images.push(imageTag);
    return token;
  });

  return { html: tokenizedHtml, images };
}

/**
 * Clean Amazon description HTML for safe eBay rendering.
 * Strips Amazon CSS classes, scripts, styles, and wraps in a clean container.
 * Description images are preserved as simple responsive <img> tags.
 */
function cleanDescriptionHtml(html: string): string {
  try {
    let cleaned = html;
    // 1. Remove <h1> tags and contents (Amazon product title)
    cleaned = cleaned.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');
    // 2. Remove <script> tags and contents
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    // 3. Remove <style> tags and contents
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // 4. Preserve image sources before stripping the original tag attributes.
    const tokenizedImages = replaceDescriptionImagesWithTokens(cleaned);
    cleaned = tokenizedImages.html;
    // 5. Remove class attributes
    cleaned = cleaned.replace(/\s+class="[^"]*"/g, '');
    // 6. Remove id attributes
    cleaned = cleaned.replace(/\s+id="[^"]*"/g, '');
    // 7. Remove style attributes
    cleaned = cleaned.replace(/\s+style="[^"]*"/g, '');
    // 8. Remove data-* attributes
    cleaned = cleaned.replace(/\s+data-[a-z-]+="[^"]*"/g, '');
    // 9. Remove layout attributes that can force fixed-width or no-wrap sections.
    cleaned = cleaned.replace(/\s+(width|height|align|valign|border|cellpadding|cellspacing)=("[^"]*"|'[^']*')/gi, '');
    cleaned = cleaned.replace(/\s+nowrap(=("[^"]*"|'[^']*'))?/gi, '');
    // 10. Reinsert sanitized description images.
    cleaned = cleaned.replace(/__LISTFLOW_DESC_IMAGE_(\d+)__/g, (_, index) => {
      return tokenizedImages.images[Number(index)] ?? "";
    });
    // 11. Remove <hr> dividers
    cleaned = cleaned.replace(/<hr[^>]*\/?>/gi, '');
    // 12. Replace &amp; with &
    cleaned = cleaned.replace(/&amp;/g, '&');
    // 13. Collapse excessive <br> tags
    cleaned = cleaned.replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br><br>');
    // 14. Wrap in a clean container div
    cleaned = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;margin:0 auto;">${cleaned}</div>`;
    return cleaned;
  } catch {
    return html;
  }
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

    // Description — flatten Amazon multi-column/A+ content into stacked eBay-safe blocks
    const description = await page.evaluate(() => {
      function normalizeText(value: string | null | undefined): string {
        return (value ?? "")
          .replace(/\u200e/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      function escapeHtml(value: string): string {
        return value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function isVisible(element: Element): boolean {
        if (
          element.closest(
            "script,style,noscript,template,[hidden],[aria-hidden='true']"
          )
        ) {
          return false;
        }

        const style = window.getComputedStyle(element as HTMLElement);
        return style.display !== "none" && style.visibility !== "hidden";
      }

      function uniqueItems(items: string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];

        items.forEach((item) => {
          const key = item.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          result.push(item);
        });

        return result;
      }

      function extractImageUrl(element: HTMLImageElement): string {
        const candidates = [
          element.getAttribute("data-old-hires"),
          element.getAttribute("data-src"),
          element.currentSrc,
          element.src,
        ];

        for (const candidate of candidates) {
          const value = normalizeText(candidate);
          if (/^https?:\/\//i.test(value)) {
            return value;
          }
        }

        const dynamicImage = element.getAttribute("data-a-dynamic-image") ?? "";
        const match = dynamicImage.match(/https?:\/\/[^"'}\],\s]+/i);
        return match ? match[0] : "";
      }

      type DescriptionBlock =
        | { type: "heading"; text: string; level: number }
        | { type: "paragraph"; text: string }
        | { type: "list"; items: string[] }
        | { type: "image"; src: string; alt: string };

      const blocks: DescriptionBlock[] = [];
      const seenTexts = new Set<string>();
      const seenLists = new Set<string>();
      const seenImages = new Set<string>();

      function pushHeading(text: string, level = 2): void {
        const normalized = normalizeText(text);
        if (!normalized) return;

        const key = `heading:${normalized.toLowerCase()}`;
        if (seenTexts.has(key)) return;
        seenTexts.add(key);

        blocks.push({
          type: "heading",
          text: normalized,
          level: Math.min(Math.max(level, 2), 4),
        });
      }

      function pushParagraph(text: string): void {
        const normalized = normalizeText(text);
        if (!normalized) return;

        const key = `paragraph:${normalized.toLowerCase()}`;
        if (seenTexts.has(key)) return;
        seenTexts.add(key);

        blocks.push({ type: "paragraph", text: normalized });
      }

      function pushList(items: string[]): void {
        const normalizedItems = uniqueItems(
          items.map((item) => normalizeText(item)).filter(Boolean)
        );

        if (normalizedItems.length === 0) return;

        const key = normalizedItems.map((item) => item.toLowerCase()).join("||");
        if (seenLists.has(key)) return;
        seenLists.add(key);

        blocks.push({ type: "list", items: normalizedItems });
      }

      function pushImage(src: string, alt: string): void {
        const normalizedSrc = normalizeText(src);
        if (
          !/^https?:\/\//i.test(normalizedSrc) ||
          /play-button|spinner|loading|transparent|pixel/i.test(normalizedSrc)
        ) {
          return;
        }

        if (seenImages.has(normalizedSrc)) return;
        seenImages.add(normalizedSrc);

        blocks.push({
          type: "image",
          src: normalizedSrc,
          alt: normalizeText(alt),
        });
      }

      function collectListItems(list: Element): string[] {
        return uniqueItems(
          Array.from(list.querySelectorAll("li"))
            .map((item) => normalizeText(item.textContent))
            .filter(Boolean)
        );
      }

      function collectBlocks(root: Element | null): void {
        if (!root) return;

        const walk = (node: Element): void => {
          Array.from(node.children).forEach((child) => {
            if (!isVisible(child)) return;

            const tagName = child.tagName.toLowerCase();

            if (tagName === "img") {
              const image = child as HTMLImageElement;
              pushImage(extractImageUrl(image), image.alt ?? "");
              return;
            }

            if (/^h[1-6]$/.test(tagName)) {
              pushHeading(child.textContent ?? "", Number(tagName.slice(1)));
              return;
            }

            if (tagName === "p") {
              pushParagraph(child.textContent ?? "");
              return;
            }

            if (tagName === "ul" || tagName === "ol") {
              pushList(collectListItems(child));
              return;
            }

            if (tagName === "br" || tagName === "hr") {
              return;
            }

            const hasNestedSemanticBlocks = Boolean(
              child.querySelector("img,h1,h2,h3,h4,h5,h6,p,ul,ol")
            );

            if (!hasNestedSemanticBlocks) {
              const text = normalizeText(child.textContent);
              if (text) {
                pushParagraph(text);
                return;
              }
            }

            walk(child);
          });
        };

        walk(root);
      }

      const featureBullets = document.querySelector("#feature-bullets");
      const productDescription = document.querySelector("#productDescription");
      const aplus = document.querySelector("#aplus, #aplus_feature_div");

      const featureItems = featureBullets ? collectListItems(featureBullets) : [];
      if (featureItems.length > 0) {
        pushHeading("About this item", 2);
        pushList(featureItems);
      }

      collectBlocks(productDescription);
      collectBlocks(aplus);

      if (blocks.length === 0) {
        let html = "";
        if (featureBullets) html += featureBullets.outerHTML;
        if (productDescription) html += productDescription.outerHTML;
        if (aplus) html += aplus.outerHTML;
        return html;
      }

      const sections: DescriptionBlock[][] = [];
      let currentSection: DescriptionBlock[] = [];

      const flushSection = () => {
        if (currentSection.length > 0) {
          sections.push(currentSection);
          currentSection = [];
        }
      };

      blocks.forEach((block) => {
        if (block.type === "image") {
          flushSection();
          currentSection.push(block);
          return;
        }

        if (block.type === "heading" && currentSection.length > 0) {
          flushSection();
        }

        currentSection.push(block);
      });

      flushSection();

      const renderBlock = (
        block: DescriptionBlock,
        index: number,
        section: DescriptionBlock[]
      ): string => {
        const textBlockStyle =
          "margin:0 0 14px;font-size:16px;line-height:1.75;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;";

        if (
          block.type === "paragraph" &&
          index === 1 &&
          section[0]?.type === "image" &&
          block.text.length <= 120
        ) {
          return `<div style="margin:16px 0 10px;font-size:28px;font-weight:700;line-height:1.35;color:#ef3b2d;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
            block.text
          )}</div>`;
        }

        if (block.type === "heading") {
          const fontSize =
            block.level <= 2 ? "24px" : block.level === 3 ? "20px" : "18px";
          return `<div style="margin:16px 0 10px;font-size:${fontSize};font-weight:700;line-height:1.35;color:#ef3b2d;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
            block.text
          )}</div>`;
        }

        if (block.type === "paragraph") {
          return `<div style="${textBlockStyle}">${escapeHtml(block.text)}</div>`;
        }

        if (block.type === "list") {
          return `<div style="margin:0 0 16px;">${block.items
            .map(
              (item) =>
                `<div style="margin:0 0 8px;padding-left:18px;text-indent:-18px;font-size:16px;line-height:1.8;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">&#8226; ${escapeHtml(
                  item
                )}</div>`
            )
            .join("")}</div>`;
        }

        return `<div style="margin:18px 0;text-align:center;"><img src="${escapeHtml(
          block.src
        )}" alt="${escapeHtml(
          block.alt
        )}" style="max-width:100%;height:auto;display:block;margin:0 auto;" /></div>`;
      };

      return sections
        .map(
          (section) =>
            `<div style="margin:0 0 18px;">${section
              .map((block, index) => renderBlock(block, index, section))
              .join("")}</div>`
        )
        .join("");
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

    // Truncate title to eBay's 80-character limit at a word boundary
    const truncatedTitle = title.length > 80
      ? title.slice(0, 80).replace(/\s+\S*$/, "")
      : title;

    return {
      title: truncatedTitle,
      description: cleanDescriptionHtml(description),
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
