import { chromium, type Browser } from "playwright";

export interface ScrapedProduct {
  title: string;
  description: string;
  images: string[];
  price: number | null;
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

// ── Amazon → eBay item specifics mapping ──────────────────────────────

/**
 * Amazon fields that are internal / irrelevant to eBay listings.
 * These are stripped from the final item specifics.
 */
const AMAZON_FIELDS_TO_REMOVE = new Set([
  "asin",
  "date first available",
  "best sellers rank",
  "customer reviews",
  "manufacturer",          // Brand is already extracted separately
  "item model number",
  "is discontinued by manufacturer",
  "batteries",
  "batteries required",
  "batteries included",
  "country of origin",
]);

/**
 * Direct 1:1 field name mappings from Amazon → eBay.
 * Keys are lowercase Amazon field names; values are the eBay-expected names.
 */
const AMAZON_TO_EBAY_FIELD_MAP: Record<string, string> = {
  "color":                  "Colour",
  "colour":                 "Colour",
  "material type":          "Material",
  "material":               "Material",
  "item weight":            "Item Weight",
  "product dimensions":     "__dimensions__",   // handled specially
  "package dimensions":     "__dimensions__",   // handled specially
  "item dimensions":        "__dimensions__",   // handled specially
  "item dimensions d x w x h": "__dimensions__", // handled specially
  "item dimensions lxwxh":  "__dimensions__",   // handled specially
  "item dimensions  lxwxh": "__dimensions__",   // double-space variant
  "style":                  "Style",
  "pattern":                "Pattern",
  "finish type":            "Finish",
  "shape":                  "Shape",
  "power source":           "Power Source",
  "voltage":                "Voltage",
  "wattage":                "Wattage",
  "connectivity technology":"Connectivity",
  "number of items":        "Number of Items",
  "special feature":        "Features",
  "special features":       "Features",
};

/**
 * Parses a dimension string like "120 x 50 x 86.8 cm" or "47.2 x 19.7 x 34.2 inches"
 * into { length, width, height } with units.
 */
function parseDimensions(raw: string): { length: string; width: string; height: string } | null {
  // Match patterns like "120 x 50 x 86.8 cm", "120 * 50 * 86.8 cm", or "120L x 50W x 86.8H cm"
  const normalized = raw.replace(/\*/g, "x");
  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*(cm|centimetres|centimeters|mm|m|inches|in)?/i
  );

  if (!match) return null;

  const [, d1, d2, d3, unitRaw] = match;
  const unit = unitRaw ? ` ${unitRaw.toLowerCase().replace("centimetres", "cm").replace("centimeters", "cm").replace("inches", "cm").replace("in", "cm")}` : " cm";

  return {
    length: `${d1}${unit}`,
    width:  `${d2}${unit}`,
    height: `${d3}${unit}`,
  };
}

/**
 * Normalizes raw Amazon item specifics into eBay-compatible field names.
 * - Parses combined dimension fields into separate Length/Width/Height
 * - Renames fields using the mapping table
 * - Strips Amazon-internal fields
 */
function normalizeItemSpecificsForEbay(
  specs: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [rawKey, value] of Object.entries(specs)) {
    const lowerKey = rawKey.toLowerCase().trim();

    // Skip Amazon-internal fields
    if (AMAZON_FIELDS_TO_REMOVE.has(lowerKey)) continue;

    const mappedKey = AMAZON_TO_EBAY_FIELD_MAP[lowerKey];

    if (mappedKey === "__dimensions__") {
      // Parse combined dimensions into separate fields
      const dims = parseDimensions(value);
      if (dims) {
        if (!result["Item Length"]) result["Item Length"] = dims.length;
        if (!result["Item Width"])  result["Item Width"]  = dims.width;
        if (!result["Item Height"]) result["Item Height"] = dims.height;
      }
      continue;
    }

    if (mappedKey) {
      // Use the eBay-standard name, don't overwrite if already set
      if (!result[mappedKey]) result[mappedKey] = value;
    } else {
      // Pass through as-is (capitalize first letter for consistency)
      const cleanKey = rawKey.trim();
      if (!result[cleanKey]) result[cleanKey] = value;
    }
  }

  return result;
}

/**
 * Track which Browser instance already has its delivery postcode set.
 * This prevents setting it on every single product page — once per
 * browser session is enough because Amazon stores it in a cookie.
 */
const postcodeSetForBrowser = new WeakSet<Browser>();

/**
 * Set the delivery postcode on Amazon AU by interacting with the
 * location popup. This ensures the scraper sees AU pricing and
 * availability regardless of where the server is located.
 *
 * Handles two scenarios:
 * 1. Amazon auto-shows the popup (common for non-AU IPs)
 * 2. We need to click the "Deliver to" link to open it
 *
 * Non-blocking: returns true on success, false if the interaction
 * failed. The scraper will still work without it.
 */
async function setAmazonDeliveryPostcode(
  page: import("playwright").Page,
  postcode: string
): Promise<boolean> {
  try {
    // Step 1: Check if the popup is already auto-shown by Amazon
    // (happens when Amazon detects a non-AU IP)
    let popupOpen = await page
      .locator("#GLUXZipUpdateInput")
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // Step 2: If popup is NOT already open, click the location link
    if (!popupOpen) {
      const locationLink = page.locator("#nav-global-location-popover-link");
      if (!(await locationLink.isVisible({ timeout: 3000 }).catch(() => false))) {
        return false;
      }
      await locationLink.click();
      popupOpen = await page
        .locator("#GLUXZipUpdateInput")
        .isVisible({ timeout: 5000 })
        .catch(() => false);
    }

    if (!popupOpen) {
      return false;
    }

    // Step 3: Type the postcode
    const zipInput = page.locator("#GLUXZipUpdateInput");
    await zipInput.fill(postcode);

    // Step 4: Click Apply
    const applyBtn = page.locator(
      '#GLUXZipUpdate input[type="submit"], #GLUXZipUpdate .a-button-input, #GLUXZipUpdate .a-button'
    );
    await applyBtn.first().click();

    // Step 5: Wait for Amazon to process — it may show a city dropdown
    await page.waitForTimeout(2000);

    // Step 6: If a city selection appears, pick the first option
    const cityList = page.locator("#GLUXCityList select, #GLUXCityPopover select");
    if (await cityList.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cityList.first().selectOption({ index: 1 });
      await page.waitForTimeout(1000);
    }

    // Step 7: Click Done/Continue — this typically triggers a full page reload
    const doneBtn = page.locator(
      '[name="glowDoneButton"], #GLUXConfirmClose, .a-popover-footer .a-button-primary'
    );
    if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
        doneBtn.first().click(),
      ]);
    }

    // Step 8: Ensure page is stable after any reload
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1000);

    return true;
  } catch {
    // Non-blocking — if anything fails, we proceed with default location
    return false;
  }
}

async function extractAmazonPriceFromPage(
  page: import("playwright").Page
): Promise<number | null> {
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

  // Fallback: scan DOM containers for price-like patterns instead of
  // stripping all non-numeric characters (which caused the thirteen cent
  // incident by concatenating shipping fees with product prices).
  const fallbackCandidates = await page.evaluate(() => {
    const containers = [
      document.querySelector("#corePrice_feature_div"),
      document.querySelector("#apex_desktop"),
      document.querySelector("#buybox"),
    ];

    const allText: string[] = [];

    for (const container of containers) {
      const text = container?.textContent?.trim();
      if (text) {
        allText.push(text);
      }
    }

    if (allText.length === 0) {
      return [];
    }

    // Extract price-like patterns: "$999.00", "A$999.00", "AU$1,299.00"
    const pricePattern = /(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\b/g;
    const found: string[] = [];

    for (const text of allText) {
      let match: RegExpExecArray | null;
      while ((match = pricePattern.exec(text)) !== null) {
        found.push(match[1]);
      }
    }

    return found;
  });

  if (fallbackCandidates.length === 0) {
    return null;
  }

  // Parse all candidates, reject anything below $1.00
  const SCRAPER_MIN_PRICE = 1.0;
  const validPrices: number[] = [];

  for (const raw of fallbackCandidates) {
    const price = parseAmazonPriceValue(raw);
    if (price !== null && price >= SCRAPER_MIN_PRICE) {
      validPrices.push(price);
    }
  }

  if (validPrices.length === 0) {
    return null;
  }

  // Pick the most frequently occurring price (real prices appear multiple
  // times on the page; noise values like shipping fees appear once).
  const frequency = new Map<number, number>();
  for (const price of validPrices) {
    frequency.set(price, (frequency.get(price) ?? 0) + 1);
  }

  let bestPrice = validPrices[0];
  let bestCount = 0;
  for (const [price, count] of frequency) {
    if (count > bestCount) {
      bestCount = count;
      bestPrice = price;
    }
  }

  return bestPrice;
}

export async function scrapeAmazonPrice(
  asin: string,
  browser?: Browser,
  postcode?: string
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

    // Set delivery postcode once per browser session so Amazon shows
    // AU-local prices and availability (e.g. Kogarah 2217)
    if (postcode && !postcodeSetForBrowser.has(ownedBrowser)) {
      const success = await setAmazonDeliveryPostcode(page, postcode);
      if (success) {
        postcodeSetForBrowser.add(ownedBrowser);
        // Reload the page to get updated prices for this postcode
        await page.goto(`https://www.amazon.com.au/dp/${normalizedAsin}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      }
    }
    return extractAmazonPriceFromPage(page);
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

export async function scrapeAmazonProduct(
  url: string,
  postcode?: string
): Promise<ScrapedProduct> {
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

    if (postcode && !postcodeSetForBrowser.has(browser)) {
      const success = await setAmazonDeliveryPostcode(page, postcode);
      if (success) {
        postcodeSetForBrowser.add(browser);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      }
    }

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

    const price = await extractAmazonPriceFromPage(page);

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

    // Item specifics — merge both Amazon AU layouts:
    // table rows and the detail bullets list.
    const itemSpecifics = await page.evaluate(() => {
      const specs: Record<string, string> = {};

      function cleanText(value: string | null | undefined): string {
        return (value ?? "")
          .replace(/[\u200e\u200f]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalizeKey(value: string): string {
        return cleanText(value).replace(/\s*[:\-]\s*$/, "").trim();
      }

      function normalizeValue(value: string): string {
        return cleanText(value).replace(/^[:\-]\s*/, "").trim();
      }

      function addSpec(rawKey: string | null | undefined, rawValue: string | null | undefined): void {
        const key = normalizeKey(rawKey ?? "");
        const value = normalizeValue(rawValue ?? "");

        if (!key || !value) return;
        if (/customer/i.test(key) || /best seller/i.test(key)) return;
        if (!specs[key]) {
          specs[key] = value;
        }
      }

      const rows = document.querySelectorAll(
        "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .a-keyvalue tr"
      );
      rows.forEach((row) => {
        addSpec(
          row.querySelector("th")?.textContent,
          row.querySelector("td")?.textContent
        );
      });

      const bulletItems = document.querySelectorAll(
        "#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li"
      );
      bulletItems.forEach((item) => {
        const label = item.querySelector(".a-text-bold");
        if (label) {
          const labelText = cleanText(label.textContent);
          const fullText = cleanText(item.textContent);
          const valueText = fullText.startsWith(labelText)
            ? fullText.slice(labelText.length)
            : fullText.replace(labelText, "");

          addSpec(labelText, valueText);
          return;
        }

        const spans = Array.from(item.querySelectorAll("span"))
          .map((span) => cleanText(span.textContent))
          .filter(Boolean);

        if (spans.length >= 2) {
          addSpec(spans[0], spans.slice(1).join(" "));
        }
      });

      return specs;
    });

    // Truncate title to eBay's 80-character limit at a word boundary
    const truncatedTitle = title.length > 80
      ? title.slice(0, 80).replace(/\s+\S*$/, "")
      : title;

    // Map Amazon field names to eBay-required field names
    const normalizedSpecs = normalizeItemSpecificsForEbay(itemSpecifics);

    return {
      title: truncatedTitle,
      description: cleanDescriptionHtml(description),
      images,
      price,
      condition: "New",
      category,
      categoryId: "",
      categoryName: "",
      itemSpecifics: normalizedSpecs,
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
