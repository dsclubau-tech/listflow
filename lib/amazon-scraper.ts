import type { Browser, Page } from "playwright-core";
import { load } from "cheerio";
import { extractLocalizedBuyboxPriceChoices } from "@/lib/amazon-buybox-price";
import { parseAmazonShippingFeeFromText } from "@/lib/amazon-shipping";
import { extractAmazonNewOfferStockLeft } from "@/lib/amazon-stock";
import { launchScraperBrowser } from "@/lib/scraper-browser";
import { isUsefulItemSpecificCandidate } from "@/lib/item-specifics";
import {
  DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import {
  addPackageDimensionItemSpecifics,
  extractPackageDimensions,
  fillMissingPackageDimensionItemSpecifics,
  logConvertedPackageDimensionUnits,
  parsePackageDimensionValue,
} from "@/lib/amazon-package-dimensions";
import { dedupeProductImages } from "@/lib/product-images";
import { toEbayListingTitle } from "@/lib/product-title";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";
import {
  PriceCheckFailure,
  getAmazonTechnicalPageMessage,
  isVerifiedAmazonProductPage,
} from "@/lib/price-check-failures";
import {
  attemptVariantSelection,
  type VariantSelectionHints,
} from "@/lib/amazon-variant-selection";

export interface ScrapedProduct {
  title: string;
  fullTitle?: string;
  description: string;
  images: string[];
  price: number | null;
  rawPrice?: number | null;
  shippingPrice?: number | null;
  condition: "New"; // Amazon products are always new
  category: string;
  categoryId: string;
  categoryName: string;
  itemSpecifics: Record<string, string>;
  variantName: string | null;
  asin: string;
  brand: string;
  amazonPriceTrackingMode?: AmazonPriceTrackingMode;
  priceChoices?: {
    regular: { price: number; label: string } | null;
    deal: { price: number; label: string } | null;
  };
  supplierDefaults?: {
    quantity: number;
    country: string;
    zipcode: string;
    shippingMethod: string;
    storeNumber: number;
    shippingPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
    policyTemplateId: string | null;
    capitalizeTitle: boolean;
  };
}

export interface ScrapedAmazonPrice {
  price: number | null;
  rawPrice?: number | null;
  shippingPrice?: number | null;
  stockLeft: number | null;
  priceMode?: AmazonPriceTrackingMode;
  priceChoices?: {
    regular: number | null;
    deal: number | null;
  };
  variantSelectionFailed?: boolean;
  variantSelectionReason?: string;
  detectedAsin?: string | null;
  asinRedirected?: boolean;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

function extractAmazonAsin(value: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  const patterns = [
    /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:[&#]|$)/,
    /\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

function getCanonicalAmazonProductUrl(url: string): string {
  const asin = extractAmazonAsin(url);
  return asin ? `https://www.amazon.com.au/dp/${asin}` : url;
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
  "product dimensions l x w x h": "__dimensions__",
  "product dimensions d x w x h": "__dimensions__",
  "package dimensions l x w x h": "__dimensions__",
  "package dimensions d x w x h": "__dimensions__",
  "item dimensions l x w x h": "__dimensions__",
  "item dimensions d x w x h": "__dimensions__", // handled specially
  "item dimensions lxwxh":  "__dimensions__",   // handled specially
  "item dimensions  lxwxh": "__dimensions__",   // double-space variant
  "item package dimensions l x w x h": "__dimensions__",
  "item package dimensions lxwxh": "__dimensions__",
  "style":                  "Style",
  "pattern":                "Pattern",
  "finish type":            "Finish",
  "shape":                  "Shape",
  "power source":           "Power Source",
  "voltage":                "Voltage",
  "wattage":                "Wattage",
  "connectivity technology":"Connectivity",
  "number of items":        "Number of Items",
  "item model number":      "Model Number",
  "manufacturer part number": "Manufacturer Part Number",
  "part number":            "Manufacturer Part Number",
  "special feature":        "Features",
  "special features":       "Features",
};

/**
 * Parses a dimension string like "120 x 50 x 86.8 cm" or "47.2 x 19.7 x 34.2 inches"
 * into { length, width, height } with units.
 */
function parseDimensions(raw: string): { length: string; width: string; height: string } | null {
  const packageDimensions = parsePackageDimensionValue(raw);
  if (packageDimensions) {
    return {
      length: `${packageDimensions.lengthCm} cm`,
      width: `${packageDimensions.widthCm} cm`,
      height: `${packageDimensions.heightCm} cm`,
    };
  }

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
    if (!isUsefulItemSpecificCandidate(rawKey, value)) continue;

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
  page: Page,
  postcode: string
): Promise<boolean> {
  // Strategy 1: Call Amazon's AJAX address-change endpoint directly.
  // This is what the location popup does under the hood — far more reliable
  // than trying to click through the popup UI which changes frequently.
  try {
    const ajaxResult = await page.evaluate(async (pc: string) => {
      const formData = new URLSearchParams({
        locationType: "LOCATION_INPUT",
        zipCode: pc,
        storeContext: "pc",
        deviceType: "web",
        pageType: "Detail",
        actionSource: "glow",
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(
          "/gp/delivery/ajax/address-change.html",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          return { success: false, reason: `HTTP ${response.status}` };
        }

        const text = await response.text();
        // Amazon returns JSON — a successful response contains "isValidAddress":1
        const isValid =
          text.includes('"isValidAddress":1') ||
          text.includes('"isValidAddress": 1');
        return { success: isValid, reason: isValid ? "ok" : "invalid address response" };
      } catch (fetchError) {
        return {
          success: false,
          reason: fetchError instanceof Error ? fetchError.message : "fetch timed out or failed",
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }, postcode);

    if (ajaxResult.success) {
      return true;
    }

    console.warn(
      `[setAmazonDeliveryPostcode] AJAX method failed: ${ajaxResult.reason}. Trying popup fallback.`
    );
  } catch {
    console.warn(
      "[setAmazonDeliveryPostcode] AJAX method threw. Trying popup fallback."
    );
  }

  // Strategy 2: Fall back to the traditional popup interaction.
  try {
    // Check if the popup is already auto-shown by Amazon
    let popupOpen = await page
      .locator("#GLUXZipUpdateInput")
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // If popup is NOT already open, click the location link
    if (!popupOpen) {
      const locationLink = page.locator("#nav-global-location-popover-link");
      if (!(await locationLink.isVisible({ timeout: 3000 }).catch(() => false))) {
        return false;
      }
      await locationLink.click({ timeout: 5000 }).catch(() => {});
      popupOpen = await page
        .locator("#GLUXZipUpdateInput")
        .isVisible({ timeout: 5000 })
        .catch(() => false);
    }

    if (!popupOpen) {
      return false;
    }

    // Type the postcode
    const zipInput = page.locator("#GLUXZipUpdateInput");
    await zipInput.fill(postcode, { timeout: 5000 });

    // Click Apply
    const applyBtn = page.locator(
      '#GLUXZipUpdate input[type="submit"], #GLUXZipUpdate .a-button-input, #GLUXZipUpdate .a-button'
    );
    await applyBtn.first().click({ timeout: 5000 });

    // Wait for Amazon to process
    await page.waitForTimeout(2000);

    // If a city selection appears, pick the first option
    const cityList = page.locator("#GLUXCityList select, #GLUXCityPopover select");
    if (await cityList.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cityList.first().selectOption({ index: 1 }, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Click Done/Continue
    const doneBtn = page.locator(
      '[name="glowDoneButton"], #GLUXConfirmClose, .a-popover-footer .a-button-primary'
    );
    if (await doneBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
        doneBtn.first().click({ timeout: 5000 }).catch(() => {}),
      ]);
    }

    // Ensure page is stable after any reload
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);

    return true;
  } catch {
    return false;
  }
}

async function extractAmazonPriceFromPage(
  page: Page
): Promise<number | null> {
  const selectors = [
    "#priceblock_ourprice",
    ".a-price .a-offscreen",
    "#aod-offer .a-price .a-offscreen",
    "#aod-offer-list .a-price .a-offscreen",
    "#aod-price-0 .a-offscreen",
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
      document.querySelector("#aod-container"),
      document.querySelector("#aod-offer-list"),
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
  }).catch(() => [] as string[]);

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

async function extractAmazonBuyboxPriceChoicesFromPage(
  page: Page,
  asin: string
) {
  await page
    .waitForSelector(
      "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, [data-csa-c-delivery-price], #deliveryBlockMessage",
      { timeout: 3000 }
    )
    .catch(() => {});

  const html = await page.content().catch(() => "");
  if (!html) {
    return extractLocalizedBuyboxPriceChoices(load(""), asin);
  }

  return extractLocalizedBuyboxPriceChoices(load(html), asin);
}

/**
 * Read the current product ASIN from the page DOM.
 * Amazon embeds the ASIN in multiple places — we check all of them.
 */
async function extractPageAsin(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      const fromInput =
        (document.querySelector("#ASIN") as HTMLInputElement)?.value ??
        (document.querySelector('input[name="ASIN"]') as HTMLInputElement)?.value ??
        null;
      if (fromInput) return fromInput.trim().toUpperCase();

      const dataAsin = document.querySelector<HTMLElement>("[data-asin]")?.dataset.asin;
      if (dataAsin) return dataAsin.trim().toUpperCase();

      const canonical = document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href;
      const canonicalMatch = canonical?.match(/\/dp\/([A-Z0-9]{10})/i);
      if (canonicalMatch?.[1]) return canonicalMatch[1].toUpperCase();

      return null;
    })
    .catch(() => null);
}

async function extractAmazonBuyingOptionsPrice(
  page: Page,
  normalizedAsin: string,
  options: { allowOfferListingPage?: boolean; offerListingTimeoutMs?: number } = {}
): Promise<number | null> {
  const directOfferPrice = await extractAmazonPriceFromPage(page);
  if (directOfferPrice !== null) {
    return directOfferPrice;
  }

  const buyingOptionsSelectors = [
    "#buybox-see-all-buying-choices input",
    "#buybox-see-all-buying-choices button",
    "#buybox-see-all-buying-choices a",
    "#buybox-see-all-buying-choices-announce",
    "input[aria-labelledby*='buybox-see-all-buying']",
    "button[aria-labelledby*='buybox-see-all-buying']",
    "a[href*='/gp/offer-listing/']",
  ];

  for (const selector of buyingOptionsSelectors) {
    const trigger = page.locator(selector).first();
    const count = await trigger.count().catch(() => 0);

    if (count === 0) {
      continue;
    }

    await trigger.click({ timeout: 5000 }).catch(() => {});
    await page
      .waitForSelector("#aod-container, #aod-offer, #aod-offer-list", {
        timeout: 8000,
      })
      .catch(() => {});

    const offerPrice = await extractAmazonPriceFromPage(page);
    if (offerPrice !== null) {
      return offerPrice;
    }
  }

  if (options.allowOfferListingPage === false) {
    return null;
  }

  await page
    .goto(`https://www.amazon.com.au/gp/offer-listing/${normalizedAsin}`, {
      waitUntil: "domcontentloaded",
      timeout: options.offerListingTimeoutMs ?? 20000,
    })
    .catch(() => null);

  return extractAmazonPriceFromPage(page);
}

export async function scrapeAmazonPrice(
  asin: string,
  browser?: Browser,
  postcode?: string,
  priceTrackingMode: AmazonPriceTrackingMode = DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  variantSelectionHints?: VariantSelectionHints | null
): Promise<ScrapedAmazonPrice> {
  const normalizedAsin = asin.trim().toUpperCase();

  if (!/^[A-Z0-9]{10}$/.test(normalizedAsin)) {
    throw new Error("A valid ASIN is required.");
  }

  const ownedBrowser = browser ?? (await launchScraperBrowser());
  const context = await ownedBrowser.newContext({
    userAgent: getRandomUserAgent(),
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Block heavy assets (images, videos, fonts) to prevent OOM renderer crashes and accelerate DOM loading.
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    // Hide the "webdriver" flag so Amazon doesn't detect headless automation
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    await page.goto(`https://www.amazon.com.au/dp/${normalizedAsin}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Set delivery postcode so Amazon shows AU-local prices and availability.
    // If the first attempt fails, retry — a failed postcode causes Amazon to
    // geo-locate the server (often Singapore) and show "out of stock" for AU
    // products that ARE actually available for Australian delivery.
    if (postcode) {
      const MAX_POSTCODE_ATTEMPTS = 3;
      let postcodeApplied = false;

      for (let attempt = 1; attempt <= MAX_POSTCODE_ATTEMPTS; attempt++) {
        const success = await setAmazonDeliveryPostcode(page, postcode);
        if (success) {
          postcodeApplied = true;
          break;
        }

        console.warn(
          `[scrapeAmazonPrice] Postcode attempt ${attempt}/${MAX_POSTCODE_ATTEMPTS} failed for ${normalizedAsin}. ${
            attempt < MAX_POSTCODE_ATTEMPTS ? "Retrying..." : "Giving up."
          }`
        );

        if (attempt < MAX_POSTCODE_ATTEMPTS) {
          // Reload the page before retrying — Amazon sometimes needs a
          // fresh page load to show the location popup again.
          await page.goto(`https://www.amazon.com.au/dp/${normalizedAsin}`, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });
        }
      }

      // Reload after postcode is set to get updated prices
      if (postcodeApplied) {
        await page.goto(`https://www.amazon.com.au/dp/${normalizedAsin}`, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      }
    }

    // Wait for Amazon's JS to render price elements into the DOM.
    await page
      .waitForSelector(
        "#corePrice_feature_div, .a-price, #priceblock_ourprice, #apex_desktop",
        { timeout: 10000 }
      )
      .catch(() => {
        // Price containers didn't appear — fall through and let
        // extractAmazonPriceFromPage try its own selectors.
      });

    // ── ASIN redirect detection ─────────────────────────────────────────
    // Amazon silently redirects unavailable variant ASINs to an available
    // sibling variant (different ASIN, different product). If the page
    // ASIN doesn't match what we requested, the product is unavailable.
    const pageAsinBeforeVariants = await extractPageAsin(page);
    if (
      pageAsinBeforeVariants &&
      pageAsinBeforeVariants !== normalizedAsin
    ) {
      throw new PriceCheckFailure(
        PriceCheckFailureCode.AMAZON_ASIN_REDIRECT,
        `Amazon redirected ASIN ${normalizedAsin} to ${pageAsinBeforeVariants} — the original variant appears unavailable.`
      );
    }

    // Detect out-of-stock before attempting price extraction
    const stockStatus = await page
      .evaluate(() => {
        const elements = [
          document.querySelector("#buybox"),
          document.querySelector("#availability"),
          document.querySelector("#outOfStock"),
          document.querySelector("#availabilityInsideBuyBox_feature_div"),
        ];
        const text = elements
          .map((el) => el?.textContent?.toLowerCase() ?? "")
          .join(" ");
        if (
          text.includes("temporarily out of stock") ||
          text.includes("currently unavailable") ||
          text.includes("we don't know when or if this item will be back in stock")
        ) {
          return "out_of_stock";
        }
        return "available";
      })
      .catch(() => "unknown");

    if (stockStatus === "out_of_stock") {
      // Check if the delivery location is still non-AU — that means
      // the postcode setter failed and "out of stock" is a geo-location
      // issue, not a real stock issue.
      const deliveryLocation = await page
        .evaluate(() => {
          const el = document.querySelector("#glow-ingress-line2, #nav-global-location-data-modal-action");
          return el?.textContent?.trim() ?? "";
        })
        .catch(() => "");

      const isAuDelivery =
        deliveryLocation.toLowerCase().includes("australia") ||
        /\b\d{4}\b/.test(deliveryLocation); // AU postcodes are 4 digits

      if (!isAuDelivery) {
        throw new Error(
          `Could not set delivery postcode to Australia for ${normalizedAsin}. ` +
            `Amazon is delivering to "${deliveryLocation || "unknown location"}" — ` +
            `the product may appear out of stock due to geo-location.`
        );
      }

      throw new PriceCheckFailure(
        PriceCheckFailureCode.AMAZON_OUT_OF_STOCK,
        `Product ${normalizedAsin} is temporarily out of stock on Amazon — no price available.`
      );
    }

    let stockLeft = await page
      .content()
      .then((html) => extractAmazonNewOfferStockLeft(load(html)))
      .catch(() => null);

    let priceChoices = await extractAmazonBuyboxPriceChoicesFromPage(
      page,
      normalizedAsin
    );
    let selectedPrice =
      priceTrackingMode === "DEAL" ? priceChoices.deal : priceChoices.regular;
    let price = selectedPrice?.price ?? null;

    let variantSwatchSelected = false;

    // If price is not available on initial page load, check if Amazon presents variations
    // and attempt to select the exact saved colour/size in safe order
    if (price === null) {
      const variantResult = await attemptVariantSelection(
        page,
        variantSelectionHints ?? null
      );

      if (variantResult.hasVariations) {
        if (!variantResult.matched) {
          return {
            price: null,
            stockLeft: null,
            priceMode: priceTrackingMode,
            priceChoices: { regular: null, deal: null },
            variantSelectionFailed: true,
            variantSelectionReason:
              variantResult.reason ||
              "Amazon presents product variations, but the saved colour/size could not be selected.",
          };
        }

        if (variantResult.selected) {
          variantSwatchSelected = true;
          // Re-evaluate buybox price after variation selection
          await page
            .waitForSelector(
              "#corePrice_feature_div, .a-price, #priceblock_ourprice, #apex_desktop",
              { timeout: 8000 }
            )
            .catch(() => {});

          priceChoices = await extractAmazonBuyboxPriceChoicesFromPage(
            page,
            normalizedAsin
          );
          selectedPrice =
            priceTrackingMode === "DEAL" ? priceChoices.deal : priceChoices.regular;
          price = selectedPrice?.price ?? null;

          if (price !== null) {
            stockLeft = await page
              .content()
              .then((html) => extractAmazonNewOfferStockLeft(load(html)))
              .catch(() => null);
          } else {
            return {
              price: null,
              stockLeft: null,
              priceMode: priceTrackingMode,
              priceChoices: { regular: null, deal: null },
              variantSelectionFailed: true,
              variantSelectionReason: `Selected variation (${variantResult.selectedDimensions?.join(", ") || "saved variant"}) on Amazon, but no buybox price became available.`,
            };
          }
        }
      }
    }

    // ── Final ASIN integrity check ──────────────────────────────────────
    // Always verify the page ASIN matches what we requested. If Amazon
    // redirected us to a different variant without explicit variant selection,
    // we must NOT return the wrong price.
    const finalPageAsin = await extractPageAsin(page);
    if (!variantSwatchSelected && finalPageAsin && finalPageAsin !== normalizedAsin) {
      throw new PriceCheckFailure(
        PriceCheckFailureCode.AMAZON_ASIN_REDIRECT,
        `Amazon redirected ASIN ${normalizedAsin} to ${finalPageAsin} — the original variant appears unavailable.`
      );
    }

    // Diagnostic: log page context when price extraction fails
    if (price === null) {
      const pageTitle = await page.title().catch(() => "(unknown)");
      const pageUrl = page.url();
      const alternatePrice =
        priceTrackingMode === "DEAL"
          ? priceChoices.regular?.price ?? null
          : priceChoices.deal?.price ?? null;
      const bodySnippet = await page
        .evaluate(() => {
          const body = document.body?.innerText ?? "";
          return body.slice(0, 500);
        })
        .catch(() => "(could not read body)");
      const productPageIdentifiers = await page
        .evaluate(() => ({
          canonicalUrl:
            document.querySelector<HTMLLinkElement>("link[rel='canonical']")
              ?.href ?? null,
          pageAsins: [
            document.querySelector<HTMLInputElement>("#ASIN")?.value,
            document.querySelector<HTMLInputElement>("input[name='ASIN']")
              ?.value,
            document.querySelector<HTMLElement>("[data-asin]")?.dataset.asin,
          ],
        }))
        .catch(() => ({ canonicalUrl: null, pageAsins: [] }));
      const productPageConfirmed = isVerifiedAmazonProductPage({
        expectedAsin: normalizedAsin,
        url: pageUrl,
        canonicalUrl: productPageIdentifiers.canonicalUrl,
        pageAsins: productPageIdentifiers.pageAsins,
      });
      const technicalPageMessage = getAmazonTechnicalPageMessage({
        title: pageTitle,
        url: pageUrl,
        bodyText: bodySnippet,
      });

      if (technicalPageMessage || !productPageConfirmed) {
        throw new PriceCheckFailure(
          PriceCheckFailureCode.TECHNICAL_ERROR,
          `${
            technicalPageMessage ??
            "Amazon did not return a verifiable product page, so the missing price was not treated as a product failure."
          } ASIN: ${normalizedAsin}.`,
        );
      }

      console.warn(
        `[scrapeAmazonPrice] Price not found for ASIN ${normalizedAsin}.\n` +
          `  Requested mode: ${priceTrackingMode}\n` +
          `  Regular price:  ${priceChoices.regular?.price ?? "not found"}\n` +
          `  Deal price:     ${priceChoices.deal?.price ?? "not found"}\n` +
          `  Alternate mode: ${alternatePrice ?? "not found"}\n` +
          `  Page title: ${pageTitle}\n` +
          `  Page URL:   ${pageUrl}\n` +
          `  Body start: ${bodySnippet.slice(0, 200)}`
      );
    }

    return {
      price,
      stockLeft,
      priceMode: priceTrackingMode,
      priceChoices: {
        regular: priceChoices.regular?.price ?? null,
        deal: priceChoices.deal?.price ?? null,
      },
      detectedAsin: finalPageAsin,
      asinRedirected: false,
    };
  } finally {
    await context.close().catch(() => {});

    if (!browser) {
      await ownedBrowser.close().catch(() => {});
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

  const canonicalUrl = getCanonicalAmazonProductUrl(url);
  const browser = await launchScraperBrowser();

  try {
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    await page.goto(canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    await page.waitForSelector("#productTitle", { timeout: 12000 });

    // Title
    const title = await page.$eval(
      "#productTitle",
      (el) => el.textContent?.trim() ?? ""
    );

    // Images — extract all unique full-size image URLs
    const scrapedImages = await page.evaluate(() => {
      function extractBalancedArrayAfter(source: string, markerPattern: RegExp) {
        const markerMatch = markerPattern.exec(source);
        if (!markerMatch || markerMatch.index === undefined) return null;

        const start = source.indexOf("[", markerMatch.index + markerMatch[0].length);
        if (start < 0) return null;

        let depth = 0;
        let quote: string | null = null;
        let escaped = false;

        for (let index = start; index < source.length; index += 1) {
          const char = source[index];

          if (quote) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = null;
            continue;
          }

          if (char === '"' || char === "'") {
            quote = char;
            continue;
          }

          if (char === "[") depth += 1;
          else if (char === "]") {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
          }
        }

        return null;
      }

      function collectImageDataUrls(image: unknown) {
        if (!image || typeof image !== "object") return [];

        const source = image as Record<string, unknown>;
        for (const key of ["hiRes", "large", "mainUrl", "variant"]) {
          if (typeof source[key] === "string") return [source[key]];
        }

        const main = source.main;
        if (typeof main === "string") {
          return [main];
        } else if (main && typeof main === "object") {
          const entries = Object.entries(main as Record<string, unknown>)
            .filter(([url]) => /^https?:\/\//i.test(url))
            .map(([url, dimensions]) => {
              const [width, height] = Array.isArray(dimensions)
                ? dimensions.map((value) =>
                    typeof value === "number" ? value : Number(value)
                  )
                : [];
              const area =
                typeof width === "number" &&
                Number.isFinite(width) &&
                typeof height === "number" &&
                Number.isFinite(height)
                  ? width * height
                  : 0;

              return { url, area };
            });

          entries.sort((left, right) => right.area - left.area);
          return entries[0]?.url ? [entries[0].url] : [];
        }

        return [];
      }

      function addDynamicImages(images: string[], raw: string | null) {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
          images.push(...Object.keys(parsed));
        } catch {
          images.push(...(raw.match(/https?:\/\/[^"'}\],\s]+/gi) ?? []));
        }
      }

      const images: string[] = [];
      const imageBlock =
        (window as typeof window & {
          ImageBlockATF?: { colorImages?: { initial?: unknown[] } };
          ImageBlockBTF?: { colorImages?: { initial?: unknown[] } };
        }).ImageBlockATF ??
        (window as typeof window & {
          ImageBlockBTF?: { colorImages?: { initial?: unknown[] } };
        }).ImageBlockBTF;

      for (const image of imageBlock?.colorImages?.initial ?? []) {
        images.push(...collectImageDataUrls(image));
      }

      for (const script of Array.from(document.querySelectorAll("script"))) {
        const json = extractBalancedArrayAfter(
          script.textContent ?? "",
          /['"]colorImages['"]\s*:\s*\{[\s\S]*?['"]initial['"]\s*:/i
        );
        if (!json) continue;

        try {
          const parsed = JSON.parse(json) as unknown[];
          for (const image of parsed) {
            images.push(...collectImageDataUrls(image));
          }
        } catch {
          continue;
        }
      }

      if (images.length < 2) {
        for (const image of Array.from(
          document.querySelectorAll<HTMLImageElement>("img[data-a-dynamic-image]")
        )) {
          addDynamicImages(images, image.getAttribute("data-a-dynamic-image"));
        }

        const landingImage =
          document.querySelector<HTMLImageElement>("#landingImage");
        if (landingImage) {
          images.push(landingImage.getAttribute("data-old-hires") ?? "");
          images.push(landingImage.src);
        }

        for (const image of Array.from(
          document.querySelectorAll<HTMLImageElement>("#altImages img")
        )) {
          const context = [
            image.className,
            image.parentElement?.className,
            image.closest("li")?.className,
            image.closest("li")?.id,
          ].join(" ");
          if (/video/i.test(context)) continue;

          addDynamicImages(images, image.getAttribute("data-a-dynamic-image"));
          images.push(image.getAttribute("data-old-hires") ?? "");
          images.push(image.src);
        }
      }

      return images.filter(Boolean);
    });
    const images = dedupeProductImages(scrapedImages);

    // ASIN
    const asin = await page
      .$eval(
        'input[name="ASIN"], #ASIN',
        (el) => (el as HTMLInputElement).value
      )
      .catch(() => {
        return extractAmazonAsin(canonicalUrl) ?? "";
      });

    const normalizedAsin = (asin || extractAmazonAsin(canonicalUrl) || "")
      .trim()
      .toUpperCase();

    await page
      .waitForSelector(
        "#corePrice_feature_div, .a-price, #priceblock_ourprice, #apex_desktop, #buybox-see-all-buying-choices",
        { timeout: 5000 }
      )
      .catch(() => {});

    let price = await extractAmazonPriceFromPage(page);

    if (price === null && /^[A-Z0-9]{10}$/.test(normalizedAsin)) {
      price = await extractAmazonBuyingOptionsPrice(page, normalizedAsin, {
        allowOfferListingPage: false,
      });
    }

    if (price === null && postcode) {
      const success = await setAmazonDeliveryPostcode(page, postcode);
      if (success) {
        await page.goto(canonicalUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page
          .waitForSelector(
            "#corePrice_feature_div, .a-price, #priceblock_ourprice, #apex_desktop, #buybox-see-all-buying-choices",
            { timeout: 5000 }
          )
          .catch(() => {});
        price = await extractAmazonPriceFromPage(page);

        if (price === null && /^[A-Z0-9]{10}$/.test(normalizedAsin)) {
          price = await extractAmazonBuyingOptionsPrice(page, normalizedAsin, {
            allowOfferListingPage: false,
          });
        }
      }
    }

    const deliveryFeeText = await page
      .evaluate(() => {
        const selectors = [
          "#deliveryBlockMessage",
          "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE",
          "#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE",
          "#amazonGlobal_feature_div",
          "#delivery-message",
          "#ourprice_shippingmessage",
          "#price-shipping-message",
          "#freeShippingRegion",
          "#aod-offer-shipping",
          "#buybox",
          "#desktop_buybox",
          "#apex_desktop",
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el?.textContent?.trim()) {
            return el.textContent.trim();
          }
        }
        return null;
      })
      .catch(() => null);
    const shippingPrice = parseAmazonShippingFeeFromText(deliveryFeeText);
    const rawPrice = price;
    if (price !== null && shippingPrice !== null && shippingPrice > 0) {
      price = Math.round((price + shippingPrice) * 100) / 100;
    }

    // Active variant
    const variantName = await page
      .$eval(
        ".selection, .a-button-selected .a-button-text, #variation_size_name .selection, #variation_style_name .selection",
        (el) => el.textContent?.trim() ?? null
      )
      .catch(() => null);

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
          .replace(
            /(?:<|&lt;|&amp;lt;)\s*img\b[\s\S]*?(?:>|&gt;|&amp;gt;)/gi,
            " "
          )
          .replace(/\u200e/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      const excludedDescriptionTextPattern =
        /^(?:product description|see more product details|report an issue|from the manufacturer|from the brand|compare with similar items?|looking for specific info\??|customers who viewed this item also viewed)[.:!]?$/i;

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
            "script,style,noscript,template,[hidden],[aria-hidden='true'],#aplusBrandStory_feature_div,#reviewFeatureGroup,#averageCustomerReviews,#customer-reviews,.apm-tablemodule,.apm-comparison-table,[data-cel-widget*='aplus_comparison'],[id*='HLCXComparisonWidget'],[id*='comparisonTable'],.aplus-comparison-table,.comparison-table-module,table.a-bordered.comparison"
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
        if (!normalized || excludedDescriptionTextPattern.test(normalized)) return;

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
        if (
          !normalized ||
          /^\d+(\.\d+)?\s+out\s+of\s+\d+\s+stars?\s*\d*$/i.test(normalized) ||
          excludedDescriptionTextPattern.test(normalized)
        ) {
          return;
        }

        const key = `paragraph:${normalized.toLowerCase()}`;
        if (seenTexts.has(key)) return;
        seenTexts.add(key);

        blocks.push({ type: "paragraph", text: normalized });
      }

      function pushList(items: string[]): void {
        const normalizedItems = uniqueItems(
          items
            .map((item) => normalizeText(item))
            .filter(
              (item) =>
                Boolean(item) && !excludedDescriptionTextPattern.test(item)
            )
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
        return "";
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
          "margin:0 0 16px;font-size:16px;line-height:1.75;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;";

        if (
          block.type === "paragraph" &&
          index === 1 &&
          section[0]?.type === "image" &&
          block.text.length <= 120
        ) {
          return `<div style="margin:24px 0 12px;font-size:28px;font-weight:700;line-height:1.35;color:#e60000;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
            block.text
          )}</div>`;
        }

        if (block.type === "heading") {
          const fontSize =
            block.level <= 2 ? "24px" : block.level === 3 ? "20px" : "18px";
          return `<div style="margin:${index === 0 ? "0" : "24px"} 0 12px;font-size:${fontSize};font-weight:700;line-height:1.35;color:#e60000;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
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

      const rendered = sections
        .map(
          (section) =>
            `<div style="margin:0 0 18px;">${section
              .map((block, index) => renderBlock(block, index, section))
              .join("")}</div>`
        )
        .join("");

      return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;margin:0 auto;">${rendered}</div>`;
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

    const packageDimensions = extractPackageDimensions(itemSpecifics);
    logConvertedPackageDimensionUnits("amazon-scraper", packageDimensions);

    // Map Amazon field names to eBay-required field names
    const normalizedSpecs = normalizeItemSpecificsForEbay(itemSpecifics);
    const specsWithPackageDimensions = addPackageDimensionItemSpecifics(
      normalizedSpecs,
      packageDimensions,
    );
    const completeSpecsWithPackageDimensions = fillMissingPackageDimensionItemSpecifics(
      specsWithPackageDimensions,
      extractPackageDimensions(specsWithPackageDimensions),
    );

    return {
      title: toEbayListingTitle(title),
      fullTitle: title,
      description: cleanDescriptionHtml(description),
      images,
      price,
      rawPrice,
      shippingPrice,
      condition: "New",
      category,
      categoryId: "",
      categoryName: "",
      itemSpecifics: completeSpecsWithPackageDimensions,
      variantName,
      asin: normalizedAsin || asin,
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
