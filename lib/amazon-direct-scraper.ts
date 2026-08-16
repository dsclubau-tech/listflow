import "server-only";

import { load, type CheerioAPI } from "cheerio";
import {
  extractLocalizedBuyboxPriceChoices,
  type AmazonBuyboxPriceChoices,
  type AmazonBuyboxPriceResult,
} from "@/lib/amazon-buybox-price";
import {
  extractAmazonPostcodeToken,
  extractAmazonProductTitle,
  parseAmazonPostcodeResponse,
} from "@/lib/amazon-direct-parse";
import {
  DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  getAmazonPriceTrackingLabel,
  normalizeAmazonPriceTrackingMode,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import {
  addPackageDimensionItemSpecifics,
  extractPackageDimensions,
  fillMissingPackageDimensionItemSpecifics,
  logConvertedPackageDimensionUnits,
  parsePackageDimensionValue,
} from "@/lib/amazon-package-dimensions";
import {
  inferBrandItemSpecific,
  inferSizeItemSpecific,
  inferTypeItemSpecific,
  isUsefulItemSpecificCandidate,
} from "@/lib/item-specifics";
import {
  dedupeProductImages,
  normalizeProductImageUrl,
} from "@/lib/product-images";
import { normalizeFullProductTitle, toEbayListingTitle } from "@/lib/product-title";
import type { ScrapedProduct } from "@/lib/amazon-scraper";

export type AmazonScrapeStage =
  | "page_fetch"
  | "html_parse"
  | "postcode_set"
  | "price_extract"
  | "category_suggest"
  | "draft_ready";

export type AmazonScrapeStageLogger = (
  stage: AmazonScrapeStage,
  durationMs: number,
  metadata?: Record<string, unknown>
) => void;

type ScrapeDirectOptions = {
  allowMetadataOnly?: boolean;
  onStage?: AmazonScrapeStageLogger;
  postcode?: string;
  priceTrackingMode?: AmazonPriceTrackingMode;
  resolveMissingPrice?: (request: {
    asin: string;
    postcode: string;
    priceTrackingMode: AmazonPriceTrackingMode;
  }) => Promise<number | null>;
};

type CheerioSelection = ReturnType<CheerioAPI>;

const PRODUCT_FETCH_TIMEOUT_MS = 12_000;
const POSTCODE_SET_TIMEOUT_MS = 8_000;

type PostcodeApplyResult = {
  attempts: number;
  lastStatus: number | null;
  requestedPostcode: string;
  responseConfirmed: boolean;
  tokenFound: boolean;
};

const AMAZON_FIELDS_TO_REMOVE = new Set([
  "asin",
  "date first available",
  "best sellers rank",
  "customer reviews",
  "manufacturer",
  "is discontinued by manufacturer",
  "batteries",
  "batteries required",
  "batteries included",
  "country of origin",
]);

const AMAZON_UNMAPPED_ITEM_SPECIFIC_ALLOWLIST = new Set([
  "brand",
  "brand name",
  "model",
  "model name",
  "model number",
  "mpn",
  "manufacturer part number",
  "part number",
  "type",
  "product type",
  "item type",
  "use for",
  "recommended uses for product",
  "compatible devices",
  "compatible with vehicle type",
  "vehicle service type",
  "filter type",
  "surface recommendation",
  "mounting type",
  "form factor",
  "included components",
  "display type",
  "screen size",
  "video capture resolution",
  "field of view",
  "lens type",
  "focus type",
  "lens mount",
]);

const AMAZON_TO_EBAY_FIELD_MAP: Record<string, string> = {
  color: "Colour",
  colour: "Colour",
  "material type": "Material",
  material: "Material",
  "item weight": "Item Weight",
  "product dimensions": "__dimensions__",
  "package dimensions": "__dimensions__",
  "item dimensions": "__dimensions__",
  "product dimensions l x w x h": "__dimensions__",
  "product dimensions d x w x h": "__dimensions__",
  "package dimensions l x w x h": "__dimensions__",
  "package dimensions d x w x h": "__dimensions__",
  "item dimensions l x w x h": "__dimensions__",
  "item dimensions d x w x h": "__dimensions__",
  "item dimensions lxwxh": "__dimensions__",
  "item dimensions  lxwxh": "__dimensions__",
  "item package dimensions l x w x h": "__dimensions__",
  "item package dimensions lxwxh": "__dimensions__",
  style: "Style",
  pattern: "Pattern",
  "finish type": "Finish",
  shape: "Shape",
  "power source": "Power Source",
  voltage: "Voltage",
  wattage: "Wattage",
  "connectivity technology": "Connectivity",
  "number of items": "Number of Items",
  "item model number": "Model Number",
  capacity: "Capacity",
  "item volume": "Capacity",
  volume: "Capacity",
  "manufacturer part number": "Manufacturer Part Number",
  "part number": "Manufacturer Part Number",
  "special feature": "Features",
  "special features": "Features",
};

export class AmazonDirectScrapeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 422, code = "AMAZON_SCRAPE_FAILED") {
    super(message);
    this.name = "AmazonDirectScrapeError";
    this.status = status;
    this.code = code;
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractAmazonAsinFromValue(value: string): string | null {
  const decoded = decodeUrl(value);
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

export function getCanonicalAmazonProductUrl(url: string) {
  const asin = extractAmazonAsinFromValue(url);
  return asin ? `https://www.amazon.com.au/dp/${asin}` : url;
}

function getAmazonProductRetryUrl(canonicalUrl: string) {
  const retryUrl = new URL(canonicalUrl);
  retryUrl.searchParams.set("th", "1");
  retryUrl.searchParams.set("psc", "1");
  return retryUrl.toString();
}

function isAmazonAuUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("amazon.com.au");
  } catch {
    return false;
  }
}

type CookieJar = Map<string, string>;

function requestHeaders(referer?: string): Record<string, string> {
  return {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-AU,en;q=0.9,en-US;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "upgrade-insecure-requests": "1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ...(referer ? { referer } : {}),
  };
}

function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  return raw ? splitSetCookieHeader(raw) : [];
}

function storeResponseCookies(jar: CookieJar, headers: Headers) {
  for (const rawCookie of getSetCookieHeaders(headers)) {
    const [nameValue] = rawCookie.split(";");
    const separatorIndex = nameValue.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = nameValue.slice(0, separatorIndex).trim();
    const value = nameValue.slice(separatorIndex + 1).trim();
    const expired =
      /max-age=0/i.test(rawCookie) ||
      /expires=thu,\s*01 jan 1970/i.test(rawCookie);

    if (expired || !value) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function getCookieHeader(jar: CookieJar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function withCookieHeader(headers: Record<string, string>, jar?: CookieJar) {
  if (!jar || jar.size === 0) {
    return headers;
  }

  return {
    ...headers,
    cookie: getCookieHeader(jar),
  };
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function fetchAmazonHtml(
  url: string,
  timeoutMs: number,
  referer?: string,
  cookieJar?: CookieJar
) {
  try {
    const response = await fetch(url, {
      headers: withCookieHeader(requestHeaders(referer), cookieJar),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (cookieJar) {
      storeResponseCookies(cookieJar, response.headers);
    }

    if (!response.ok) {
      throw new AmazonDirectScrapeError(
        `Amazon returned HTTP ${response.status}. No draft was created.`,
        response.status >= 500 ? 502 : 422,
        "AMAZON_HTTP_ERROR"
      );
    }

    return response.text();
  } catch (error) {
    if (error instanceof AmazonDirectScrapeError) {
      throw error;
    }

    if (isTimeoutError(error)) {
      throw new AmazonDirectScrapeError(
        "Amazon is taking too long to respond. No draft was created.",
        408,
        "AMAZON_TIMEOUT"
      );
    }

    throw new AmazonDirectScrapeError(
      "Could not load Amazon product page. Please check the URL and try again.",
      422,
      "AMAZON_FETCH_FAILED"
    );
  }
}

async function setAmazonDeliveryPostcodeDirect(
  canonicalUrl: string,
  postcode: string,
  cookieJar: CookieJar,
  pageHtml: string
) {
  const normalizedPostcode = postcode.replace(/\D/g, "").slice(0, 4);
  const result: PostcodeApplyResult = {
    attempts: 0,
    lastStatus: null,
    requestedPostcode: normalizedPostcode,
    responseConfirmed: false,
    tokenFound: false,
  };

  if (normalizedPostcode.length !== 4) {
    return result;
  }

  try {
    const token = extractAmazonPostcodeToken(load(pageHtml), pageHtml);
    result.tokenFound = Boolean(token);
    const body = new URLSearchParams({
      locationType: "LOCATION_INPUT",
      zipCode: normalizedPostcode,
      storeContext: "pc",
      deviceType: "web",
      pageType: "Detail",
      actionSource: "glow",
    });
    if (token) {
      body.set("anti-csrftoken-a2z", token);
    }

    const headers = withCookieHeader(
      {
        ...requestHeaders(canonicalUrl),
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: "https://www.amazon.com.au",
        referer: canonicalUrl,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
        ...(token ? { "anti-csrftoken-a2z": token } : {}),
      },
      cookieJar
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      result.attempts += 1;
      const response = await fetch(
        "https://www.amazon.com.au/gp/delivery/ajax/address-change.html",
        {
          method: "POST",
          headers,
          body: body.toString(),
          redirect: "follow",
          cache: "no-store",
          signal: AbortSignal.timeout(POSTCODE_SET_TIMEOUT_MS),
        }
      );

      storeResponseCookies(cookieJar, response.headers);
      result.lastStatus = response.status;

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      if (parseAmazonPostcodeResponse(text, normalizedPostcode)) {
        result.responseConfirmed = true;
        return result;
      }
    }

    return result;
  } catch {
    return result;
  }
}

function detectAmazonBlock(html: string) {
  const text = html.slice(0, 10_000).toLowerCase();
  return (
    text.includes("robot check") ||
    text.includes("enter the characters you see below") ||
    text.includes("sorry, we just need to make sure you're not a robot")
  );
}

export function verifyAmazonDeliveryPostcode(html: string, postcode: string) {
  const normalizedPostcode = postcode.replace(/\D/g, "").slice(0, 4);
  if (normalizedPostcode.length !== 4 || detectAmazonBlock(html)) {
    return false;
  }

  const $ = load(html);
  const text = normalizeText($("body").text());
  const visibleOrStructuredLocationText = `${text} ${html.slice(0, 80_000)}`;

  return (
    new RegExp(`\\b${normalizedPostcode}\\b`).test(
      visibleOrStructuredLocationText
    ) &&
    /\b(?:deliver|delivery|postcode|postal|location|address|australia|au)\b/i.test(
      visibleOrStructuredLocationText
    )
  );
}

function parseDimensions(raw: string) {
  const packageDimensions = parsePackageDimensionValue(raw);
  if (packageDimensions) {
    return {
      length: `${packageDimensions.lengthCm} cm`,
      width: `${packageDimensions.widthCm} cm`,
      height: `${packageDimensions.heightCm} cm`,
    };
  }

  const normalized = raw.replace(/\*/g, "x");
  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*[A-Za-z]?\s*(cm|centimetres|centimeters|mm|m|inches|in)?/i
  );

  if (!match) {
    return null;
  }

  const [, d1, d2, d3, unitRaw] = match;
  const unit = unitRaw
    ? ` ${unitRaw
        .toLowerCase()
        .replace("centimetres", "cm")
        .replace("centimeters", "cm")
        .replace("inches", "cm")
        .replace("in", "cm")}`
    : " cm";

  return {
    length: `${d1}${unit}`,
    width: `${d2}${unit}`,
    height: `${d3}${unit}`,
  };
}

function normalizeAmazonSpecificKey(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function shouldKeepMappedItemSpecific(mappedKey: string, value: string) {
  if (
    mappedKey === "Features" &&
    (value.length > 160 || (value.match(/>/g)?.length ?? 0) > 0)
  ) {
    return false;
  }

  return true;
}

function normalizeItemSpecificsForEbay(specs: Record<string, string>) {
  const result: Record<string, string> = {};

  for (const [rawKey, value] of Object.entries(specs)) {
    const lowerKey = normalizeAmazonSpecificKey(rawKey);
    if (AMAZON_FIELDS_TO_REMOVE.has(lowerKey)) {
      continue;
    }

    if (!isUsefulItemSpecificCandidate(rawKey, value)) {
      continue;
    }

    const mappedKey = AMAZON_TO_EBAY_FIELD_MAP[lowerKey];
    if (mappedKey === "__dimensions__") {
      const dims = parseDimensions(value);
      if (dims) {
        result["Item Length"] ??= dims.length;
        result["Item Width"] ??= dims.width;
        result["Item Height"] ??= dims.height;
      }
      continue;
    }

    if (mappedKey) {
      if (!shouldKeepMappedItemSpecific(mappedKey, value)) {
        continue;
      }
      result[mappedKey] ??= value;
    } else {
      const cleanKey = rawKey.trim();
      if (cleanKey && AMAZON_UNMAPPED_ITEM_SPECIFIC_ALLOWLIST.has(lowerKey)) {
        result[cleanKey] ??= value;
      }
    }
  }

  return result;
}

function extractFirstText($: CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const text = normalizeText($(selector).first().text());
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeImageUrl(url: string) {
  return normalizeProductImageUrl(url) ?? "";
}

function addImage(images: string[], url: string | null | undefined) {
  const normalized = normalizeImageUrl(normalizeText(url));
  if (
    !normalized ||
    !/amazon|ssl-images/i.test(normalized) ||
    /play-button|spinner|loading|transparent|pixel/i.test(normalized)
  ) {
    return;
  }

  if (!images.includes(normalized)) {
    images.push(normalized);
  }
}

function extractDynamicImageUrls(raw: string | undefined) {
  if (!raw) {
    return [];
  }

  const decoded = raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  try {
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return Object.keys(parsed);
  } catch {
    const matches = decoded.match(/https?:\/\/[^"'}\],\s]+/gi);
    return matches ?? [];
  }
}

function extractBalancedArrayAfter(source: string, markerPattern: RegExp) {
  const markerMatch = markerPattern.exec(source);
  if (!markerMatch || markerMatch.index === undefined) {
    return null;
  }

  const start = source.indexOf("[", markerMatch.index + markerMatch[0].length);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function collectImageDataUrls(image: unknown) {
  if (!image || typeof image !== "object") {
    return [];
  }

  const source = image as Record<string, unknown>;
  for (const key of ["hiRes", "large", "mainUrl", "variant"]) {
    if (typeof source[key] === "string") {
      return [source[key]];
    }
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

function extractColorImages(html: string) {
  const json = extractBalancedArrayAfter(
    html,
    /['"]colorImages['"]\s*:\s*\{[\s\S]*?['"]initial['"]\s*:/i
  );
  if (!json) {
    return [];
  }

  try {
    const parsed = JSON.parse(json) as unknown[];
    return parsed.flatMap(collectImageDataUrls);
  } catch {
    return [];
  }
}

function extractImages($: CheerioAPI, html: string) {
  const images: string[] = [];

  extractColorImages(html).forEach((url) => addImage(images, url));

  if (images.length < 2) {
    $("img[data-a-dynamic-image]").each((_, image) => {
      extractDynamicImageUrls($(image).attr("data-a-dynamic-image")).forEach((url) =>
        addImage(images, url)
      );
    });

    addImage(images, $("#landingImage").attr("data-old-hires"));
    addImage(images, $("#landingImage").attr("src"));
    addImage(images, $("#imgTagWrapperId img").attr("src"));
    addImage(images, $('meta[property="og:image"]').attr("content"));

    $("#altImages img").each((_, image) => {
      const context = [
        $(image).attr("class"),
        $(image).parent().attr("class"),
        $(image).closest("li").attr("class"),
        $(image).closest("li").attr("id"),
      ].join(" ");
      if (/video/i.test(context)) {
        return;
      }

      extractDynamicImageUrls($(image).attr("data-a-dynamic-image")).forEach((url) =>
        addImage(images, url)
      );
      addImage(images, $(image).attr("data-old-hires"));
      addImage(images, $(image).attr("src"));
    });
  }

  return dedupeProductImages(images);
}

function extractAsin($: CheerioAPI, canonicalUrl: string, html: string) {
  const selectors = [
    'input[name="ASIN"]',
    "#ASIN",
    "[data-asin]",
    'input[name="asin"]',
  ];

  for (const selector of selectors) {
    const value =
      $(selector).first().attr("value") || $(selector).first().attr("data-asin");
    const asin = value ? extractAmazonAsinFromValue(`/${value}`) : null;
    if (asin) {
      return asin;
    }
  }

  const detailMatch = html.match(/\bASIN\b[^A-Z0-9]{0,20}([A-Z0-9]{10})/i);
  return (
    extractAmazonAsinFromValue(canonicalUrl) ||
    (detailMatch ? detailMatch[1].toUpperCase() : "")
  );
}

function extractBrand($: CheerioAPI, itemSpecifics: Record<string, string>) {
  const byline = normalizeText($("#bylineInfo").text())
    .replace(/^Visit the\s+/i, "")
    .replace(/\s+Store$/i, "")
    .replace(/^Brand:\s*/i, "");

  if (byline) {
    return byline;
  }

  const productOverviewBrand = extractFirstText($, [
    ".po-brand .po-break-word",
    "#productOverview_feature_div tr:contains('Brand') td:last-child",
  ]);

  return productOverviewBrand || itemSpecifics.Brand || itemSpecifics.Manufacturer || "";
}

function extractCategory($: CheerioAPI) {
  const breadcrumbs = $("#wayfinding-breadcrumbs_container a")
    .map((_, item) => normalizeText($(item).text()))
    .get()
    .filter(Boolean);

  return breadcrumbs.at(-1) ?? "General";
}

function extractVariantName($: CheerioAPI) {
  return (
    extractFirstText($, [
      ".selection",
      ".a-button-selected .a-button-text",
      "#variation_color_name .selection",
      "#variation_size_name .selection",
      "#variation_style_name .selection",
    ]) || null
  );
}

function extractItemSpecifics($: CheerioAPI) {
  const specs: Record<string, string> = {};

  function addSpec(rawKey: string | null | undefined, rawValue: string | null | undefined) {
    const key = normalizeText(rawKey).replace(/\s*[:\-]\s*$/, "");
    const value = normalizeText(rawValue).replace(/^[:\-]\s*/, "");

    if (!key || !value) {
      return;
    }

    if (/customer|best seller/i.test(key)) {
      return;
    }

    specs[key] ??= value;
  }

  $(
    "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .a-keyvalue tr, #productOverview_feature_div tr"
  ).each((_, row) => {
    const cells = $(row).find("th, td");
    addSpec(cells.eq(0).text(), cells.eq(1).text());
  });

  $("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li").each(
    (_, item) => {
      const label = normalizeText($(item).find(".a-text-bold").first().text());
      if (label) {
        const fullText = normalizeText($(item).text());
        addSpec(
          label,
          fullText.startsWith(label) ? fullText.slice(label.length) : fullText
        );
        return;
      }

      const spans = $(item)
        .find("span")
        .map((_, span) => normalizeText($(span).text()))
        .get()
        .filter(Boolean);
      if (spans.length >= 2) {
        addSpec(spans[0], spans.slice(1).join(" "));
      }
    }
  );

  const packageDimensions = extractPackageDimensions(specs);
  logConvertedPackageDimensionUnits("amazon-direct-scraper", packageDimensions);

  const normalizedSpecs = addPackageDimensionItemSpecifics(
    normalizeItemSpecificsForEbay(specs),
    packageDimensions,
  );

  // Amazon sometimes supplies dimensions as three separate fields. Those are
  // created by normalization, so parse the final shape as well as the raw page.
  return fillMissingPackageDimensionItemSpecifics(
    normalizedSpecs,
    extractPackageDimensions(normalizedSpecs),
  );
}

function withInferredItemSpecifics(
  itemSpecifics: Record<string, string>,
  title: string,
  input?: {
    brand?: string | null;
    categoryName?: string | null;
    variantName?: string | null;
  }
) {
  const next = { ...itemSpecifics };

  if (!next.Brand) {
    const inferredBrand = inferBrandItemSpecific({
      itemSpecifics: next,
      brand: input?.brand,
    });

    if (inferredBrand) {
      next.Brand = inferredBrand;
    }
  }

  if (!next.Type) {
    const inferredType = inferTypeItemSpecific({
      title,
      categoryName: input?.categoryName,
      itemSpecifics: next,
    });

    if (inferredType) {
      next.Type = inferredType;
    }
  }

  if (!next.Size) {
    const inferredSize = inferSizeItemSpecific({
      title,
      categoryName: input?.categoryName,
      itemSpecifics: {
        ...next,
        ...(input?.variantName ? { Variant: input.variantName } : {}),
      },
    });

    if (inferredSize) {
      next.Size = inferredSize;
    }
  }

  return next;
}

type DescriptionBlock =
  | { type: "heading"; html: string }
  | { type: "paragraph"; html: string }
  | { type: "list"; items: string[] }
  | { type: "faq"; question: string; answer: string }
  | { type: "image"; src: string; alt: string };

const DESCRIPTION_INLINE_TAGS = new Set(["b", "strong", "i", "em", "br"]);
const DESCRIPTION_HIDDEN_SELECTOR =
  "[hidden], [aria-hidden='true'], .aok-hidden, .a-hidden, .celwidget[style*='display: none']";
const DESCRIPTION_EXCLUDED_CONTAINER_SELECTOR = [
  "#aplusBrandStory_feature_div",
  "#reviewFeatureGroup",
  "#averageCustomerReviews",
  "#customer-reviews",
  ".apm-tablemodule",
  ".apm-comparison-table",
  "[data-cel-widget*='aplus_comparison']",
  "[id*='HLCXComparisonWidget']",
  "[id*='comparisonTable']",
  ".aplus-comparison-table",
  ".comparison-table-module",
  "table.a-bordered.comparison",
].join(", ");
const DESCRIPTION_EXCLUDED_TEXT_PATTERN =
  /^(?:product description|see more product details|report an issue|from the manufacturer|from the brand|compare with similar items?|looking for specific info\??|customers who viewed this item also viewed)[.:!]?$/i;

function stripLiteralDescriptionImageMarkup(value: string) {
  return value.replace(
    /(?:<|&lt;|&amp;lt;)\s*img\b[\s\S]*?(?:>|&gt;|&amp;gt;)/gi,
    " ",
  );
}

function normalizeDescriptionText(value: string | null | undefined) {
  return normalizeText(stripLiteralDescriptionImageMarkup(value ?? ""));
}

function isHiddenDescriptionElement(element: CheerioSelection) {
  if (element.closest(DESCRIPTION_HIDDEN_SELECTOR).length > 0) {
    return true;
  }

  const style = element.attr("style")?.toLowerCase() ?? "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/.test(style);
}

function sanitizeDescriptionInlineHtml(
  $: CheerioAPI,
  element: CheerioSelection,
) {
  const clone = element.clone();
  clone.find("script, style, noscript, button, input, form, svg").remove();
  clone.find("a").each((_, link) => {
    const linkSelection = $(link);
    if (
      /^(see more product details|report an issue|learn more)$/i.test(
        normalizeText(linkSelection.text()),
      )
    ) {
      linkSelection.remove();
    }
  });

  clone.find("*").each((_, child) => {
    const childSelection = $(child);
    const tagName = childSelection.prop("tagName")?.toLowerCase() ?? "";

    if (!DESCRIPTION_INLINE_TAGS.has(tagName)) {
      childSelection.replaceWith(childSelection.contents());
      return;
    }

    for (const attribute of Object.keys(child.attribs ?? {})) {
      childSelection.removeAttr(attribute);
    }
  });

  return stripLiteralDescriptionImageMarkup(clone.html() ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*<br\s*\/?\s*>\s*/gi, "<br>")
    .trim();
}

function getLargestSrcsetUrl(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value
    .split(",")
    .map((entry) => {
      const [url, descriptor = "0"] = entry.trim().split(/\s+/);
      const size = Number.parseFloat(descriptor);
      return { url, size: Number.isFinite(size) ? size : 0 };
    })
    .filter((entry) => entry.url)
    .sort((left, right) => right.size - left.size)[0]?.url ?? "";
}

function getDescriptionImageSource(image: CheerioSelection) {
  return (
    image.attr("data-a-hires") ||
    image.attr("data-old-hires") ||
    image.attr("data-src") ||
    getLargestSrcsetUrl(image.attr("srcset") || image.attr("data-srcset")) ||
    image.attr("src") ||
    ""
  );
}

function normalizeDescriptionImageUrl(value: string) {
  const productImageUrl = normalizeProductImageUrl(value);
  if (productImageUrl) {
    return productImageUrl;
  }

  const raw = value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .trim();

  try {
    const url = new URL(raw);
    const isAmazonImageHost =
      /(^|\.)media-amazon\.com$/i.test(url.hostname) ||
      /(^|\.)ssl-images-amazon\.com$/i.test(url.hostname);
    const isAplusMedia =
      /^\/images\/S\/aplus-media-library-service-media\//i.test(url.pathname) ||
      /^\/images\/G\/.*\/aplus/i.test(url.pathname);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      !isAmazonImageHost ||
      !isAplusMedia ||
      /play-button|play_icon|spinner|loading|transparent|pixel|grey-pixel|sprite|video/i.test(
        url.toString(),
      )
    ) {
      return "";
    }

    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function collectDescriptionBlocks($: CheerioAPI) {
  const blocks: DescriptionBlock[] = [];
  const seenText = new Set<string>();
  const seenImages = new Set<string>();
  const seenFaqs = new Set<string>();
  let hasFaqHeading = false;

  function pushText(
    type: "heading" | "paragraph",
    element: CheerioSelection,
  ) {
    if (isHiddenDescriptionElement(element)) {
      return;
    }

    const normalized = normalizeDescriptionText(element.text());
    const key = `${type}:${normalized.toLowerCase()}`;
    if (
      !normalized ||
      /^\d+(\.\d+)?\s+out\s+of\s+\d+\s+stars?\s*\d*$/i.test(normalized) ||
      DESCRIPTION_EXCLUDED_TEXT_PATTERN.test(normalized) ||
      seenText.has(key)
    ) {
      return;
    }
    seenText.add(key);
    blocks.push({
      type,
      html: sanitizeDescriptionInlineHtml($, element) || escapeHtml(normalized),
    });
  }

  function pushList(items: CheerioSelection[]) {
    const normalized: string[] = [];
    const seenItems = new Set<string>();

    for (const item of items) {
      if (isHiddenDescriptionElement(item)) {
        continue;
      }

      const text = normalizeDescriptionText(item.text());
      const key = text.toLowerCase();
      if (
        !text ||
        /^make sure this fits/i.test(text) ||
        DESCRIPTION_EXCLUDED_TEXT_PATTERN.test(text) ||
        seenItems.has(key)
      ) {
        continue;
      }

      seenItems.add(key);
      normalized.push(
        sanitizeDescriptionInlineHtml($, item) || escapeHtml(text),
      );
    }

    if (normalized.length > 0) {
      blocks.push({ type: "list", items: normalized });
    }
  }

  function pushImage(image: CheerioSelection) {
    if (
      isHiddenDescriptionElement(image) ||
      image.closest(DESCRIPTION_EXCLUDED_CONTAINER_SELECTOR).length > 0
    ) {
      return;
    }

    const src = getDescriptionImageSource(image);
    const normalizedImage = normalizeDescriptionImageUrl(normalizeText(src));
    if (
      !normalizedImage ||
      !/amazon|ssl-images/i.test(normalizedImage) ||
      seenImages.has(normalizedImage) ||
      /play-button|spinner|loading|transparent|pixel/i.test(normalizedImage)
    ) {
      return;
    }
    seenImages.add(normalizedImage);
    blocks.push({
      type: "image",
      src: normalizedImage,
      alt: normalizeText(image.attr("alt")),
    });
  }

  function pushFaq(item: CheerioSelection) {
    const questionElement = item.find(".aplus-question").first();
    const answerElement = item.find(".aplus-answer").first();
    const questionText = normalizeText(questionElement.text());
    const answerText = normalizeText(answerElement.text());
    const key = `${questionText.toLowerCase()}:${answerText.toLowerCase()}`;

    if (!questionText || !answerText || seenFaqs.has(key)) {
      return;
    }

    seenFaqs.add(key);
    if (!hasFaqHeading) {
      blocks.push({ type: "heading", html: "Frequently Asked Questions" });
      hasFaqHeading = true;
    }

    blocks.push({
      type: "faq",
      question:
        sanitizeDescriptionInlineHtml($, questionElement) ||
        escapeHtml(questionText),
      answer:
        sanitizeDescriptionInlineHtml($, answerElement) || escapeHtml(answerText),
    });
  }

  const featureItems = $("#feature-bullets li")
    .toArray()
    .map((item) => $(item));
  const visibleFeatureItems = featureItems.filter(
    (item) =>
      !isHiddenDescriptionElement(item) &&
      !/^make sure this fits/i.test(normalizeText(item.text())),
  );
  if (visibleFeatureItems.length > 0) {
    blocks.push({ type: "heading", html: "About this item" });
    pushList(visibleFeatureItems);
  }

  const productDescriptionRoot = $("#productDescription").first();
  const aplusContentSelector =
    "h1, h2, h3, h4, h5, h6, p, li, img, .a-size-base, .aplus-description, .premium-module-11-faq .faq-block";
  const aplusFeatureRoot = $("#aplus_feature_div").first();
  const embeddedAplusRoot = aplusFeatureRoot.find("#aplus").first();
  const standaloneAplusRoot = $("#aplus")
    .filter(
      (_, element) =>
        $(element).closest(DESCRIPTION_EXCLUDED_CONTAINER_SELECTOR).length === 0,
    )
    .first();
  const aplusRoot = embeddedAplusRoot.find(aplusContentSelector).length
    ? embeddedAplusRoot
    : aplusFeatureRoot.find(aplusContentSelector).length
      ? aplusFeatureRoot
      : standaloneAplusRoot;
  const descriptionCandidates: Array<{
    root: CheerioSelection;
    rootSelector: string;
    selector: string;
  }> = [
    {
      root: productDescriptionRoot,
      rootSelector: "#productDescription",
      selector: "h1, h2, h3, h4, h5, h6, p, li, img, span",
    },
    {
      root: aplusRoot,
      rootSelector: aplusRoot.is("#aplus") ? "#aplus" : "#aplus_feature_div",
      selector: aplusContentSelector,
    },
  ];
  const hasProductDescription = descriptionCandidates.some(
    ({ root, selector }) =>
      root.length > 0 &&
      root.find(selector).toArray().some((item) => {
        const candidate = $(item);
        return (
          !isHiddenDescriptionElement(candidate) &&
          candidate.closest(DESCRIPTION_EXCLUDED_CONTAINER_SELECTOR).length === 0 &&
          (candidate.is("img") ||
            Boolean(
              normalizeDescriptionText(candidate.text()) &&
                !DESCRIPTION_EXCLUDED_TEXT_PATTERN.test(
                  normalizeDescriptionText(candidate.text()),
                ),
            ))
        );
      }),
  );

  if (hasProductDescription) {
    blocks.push({ type: "heading", html: "Product Description" });

    for (const { root, rootSelector, selector } of descriptionCandidates) {
      if (!root.length) {
        continue;
      }

      root.find(selector).each((_, item) => {
        const candidate = $(item);

        if (
          candidate.closest(DESCRIPTION_EXCLUDED_CONTAINER_SELECTOR).length > 0
        ) {
          return;
        }

        if (
          candidate.closest(".premium-module-11-faq .faq-block").length > 0 &&
          !candidate.is(".faq-block")
        ) {
          return;
        }

        if (candidate.is(".premium-module-11-faq .faq-block")) {
          pushFaq(candidate);
          return;
        }

        if (candidate.is("img")) {
          pushImage(candidate);
          return;
        }

        if (
          candidate.parentsUntil(rootSelector).is("p, li, h1, h2, h3, h4, h5, h6") ||
          candidate.is(".a-size-base, .aplus-description") &&
            candidate.find("p, li, h1, h2, h3, h4, h5, h6").length > 0
        ) {
          return;
        }

        if (candidate.is("li")) {
          pushList([candidate]);
        } else if (candidate.is("h1, h2, h3, h4, h5, h6")) {
          pushText("heading", candidate);
        } else {
          pushText("paragraph", candidate);
        }
      });
    }
  }

  return blocks;
}

export function renderAmazonDescription($: CheerioAPI) {
  const blocks = collectDescriptionBlocks($);

  if (blocks.length === 0) {
    return "";
  }

  const rendered = blocks
    .map((block, index) => {
      if (block.type === "heading") {
        const sectionHeading =
          block.html === "About this item" || block.html === "Product Description";
        const color = block.html === "About this item" ? "#e60000" : "#111";
        return `<div style="margin:${index === 0 ? "0" : "24px"} 0 12px;font-size:${sectionHeading ? "22px" : "20px"};font-weight:700;line-height:1.35;color:${color};white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${block.html}</div>`;
      }

      if (block.type === "paragraph") {
        return `<div style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${block.html}</div>`;
      }

      if (block.type === "list") {
        return `<div style="margin:0 0 16px;">${block.items
          .map(
            (item) =>
              `<div style="margin:0 0 8px;padding-left:18px;text-indent:-18px;font-size:16px;line-height:1.8;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">&#8226; ${item}</div>`
          )
          .join("")}</div>`;
      }

      if (block.type === "faq") {
        return `<div style="margin:0 0 16px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:6px;"><div style="margin:0 0 6px;font-size:16px;font-weight:700;line-height:1.5;color:#111;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${block.question}</div><div style="margin:0;font-size:16px;line-height:1.7;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${block.answer}</div></div>`;
      }

      return `<div style="margin:18px 0;text-align:center;"><img src="${escapeHtml(
        block.src
      )}" alt="${escapeHtml(
        block.alt
      )}" style="max-width:100%;height:auto;display:block;margin:0 auto;" /></div>`;
    })
    .join("");

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;margin:0 auto;">${rendered}</div>`;
}

function parseProductHtml(html: string, canonicalUrl: string): ScrapedProduct {
  if (detectAmazonBlock(html)) {
    throw new AmazonDirectScrapeError(
      "Amazon blocked the product page request. No draft was created.",
      422,
      "AMAZON_BLOCKED"
    );
  }

  const $ = load(html);
  const fullTitle = normalizeFullProductTitle(extractAmazonProductTitle($, html));
  const title = toEbayListingTitle(fullTitle);

  if (!fullTitle) {
    throw new AmazonDirectScrapeError(
      "Could not read the Amazon product title. No draft was created.",
      422,
      "AMAZON_TITLE_MISSING"
    );
  }

  const asin = extractAsin($, canonicalUrl, html);
  const images = extractImages($, html);
  const description = renderAmazonDescription($);
  const rawItemSpecifics = extractItemSpecifics($);
  const category = extractCategory($);
  const variantName = extractVariantName($);
  const brand = extractBrand($, rawItemSpecifics);
  const itemSpecifics = withInferredItemSpecifics(rawItemSpecifics, fullTitle, {
    brand,
    categoryName: category,
    variantName,
  });

  return {
    title,
    fullTitle,
    description,
    images,
    price: null,
    condition: "New" as const,
    category,
    categoryId: "",
    categoryName: "",
    itemSpecifics,
    variantName,
    asin,
    brand,
    amazonPriceTrackingMode: DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  } satisfies ScrapedProduct;
}

function toScrapedPriceChoice(choice: AmazonBuyboxPriceResult | null) {
  if (!choice) {
    return null;
  }

  return {
    price: choice.price,
    label: getAmazonPriceTrackingLabel(choice.mode),
  };
}

function toScrapedPriceChoices(choices: AmazonBuyboxPriceChoices) {
  return {
    regular: toScrapedPriceChoice(choices.regular),
    deal: toScrapedPriceChoice(choices.deal),
  };
}

function logStage(
  options: ScrapeDirectOptions,
  stage: AmazonScrapeStage,
  startedAt: number,
  metadata?: Record<string, unknown>
) {
  options.onStage?.(stage, Date.now() - startedAt, metadata);
}

function getScrapePostcode(postcode: string | undefined) {
  const normalized = postcode?.replace(/\D/g, "").slice(0, 4) ?? "";
  return normalized.length === 4 ? normalized : "2217";
}

export async function scrapeAmazonPackageItemSpecificsDirect(
  url: string,
  options: Pick<ScrapeDirectOptions, "onStage"> = {},
) {
  if (!isAmazonAuUrl(url)) {
    throw new AmazonDirectScrapeError(
      "Only Amazon AU (amazon.com.au) URLs are supported.",
      400,
      "AMAZON_URL_INVALID",
    );
  }

  const canonicalUrl = getCanonicalAmazonProductUrl(url);
  const fetchStartedAt = Date.now();
  const html = await fetchAmazonHtml(canonicalUrl, PRODUCT_FETCH_TIMEOUT_MS);
  logStage(options, "page_fetch", fetchStartedAt, {
    canonicalUrl,
    bytes: html.length,
    packageDataOnly: true,
  });

  if (detectAmazonBlock(html)) {
    throw new AmazonDirectScrapeError(
      "Amazon blocked the package-data request.",
      422,
      "AMAZON_BLOCKED",
    );
  }

  const parseStartedAt = Date.now();
  const itemSpecifics = extractItemSpecifics(load(html));
  logStage(options, "html_parse", parseStartedAt, {
    canonicalUrl,
    packageDataOnly: true,
    weightFound: Boolean(itemSpecifics._WeightKg || itemSpecifics._WeightG),
    dimensionsFound: Boolean(
      itemSpecifics._LengthCm &&
        itemSpecifics._WidthCm &&
        itemSpecifics._HeightCm,
    ),
  });

  return itemSpecifics;
}

export async function scrapeAmazonProductDirect(
  url: string,
  options: ScrapeDirectOptions = {}
): Promise<ScrapedProduct> {
  if (!isAmazonAuUrl(url)) {
    throw new AmazonDirectScrapeError(
      "Only Amazon AU (amazon.com.au) URLs are supported.",
      400,
      "AMAZON_URL_INVALID"
    );
  }

  const canonicalUrl = getCanonicalAmazonProductUrl(url);
  const cookieJar: CookieJar = new Map();

  const fetchStartedAt = Date.now();
  let html = await fetchAmazonHtml(
    canonicalUrl,
    PRODUCT_FETCH_TIMEOUT_MS,
    undefined,
    cookieJar
  );
  logStage(options, "page_fetch", fetchStartedAt, {
    canonicalUrl,
    bytes: html.length,
  });

  const parseStartedAt = Date.now();
  let product: ScrapedProduct;

  try {
    product = parseProductHtml(html, canonicalUrl);
  } catch (error) {
    if (
      !(error instanceof AmazonDirectScrapeError) ||
      error.code !== "AMAZON_TITLE_MISSING"
    ) {
      throw error;
    }

    const retryStartedAt = Date.now();
    html = await fetchAmazonHtml(
      getAmazonProductRetryUrl(canonicalUrl),
      PRODUCT_FETCH_TIMEOUT_MS,
      canonicalUrl,
      cookieJar
    );
    logStage(options, "page_fetch", retryStartedAt, {
      canonicalUrl,
      bytes: html.length,
      retry: true,
      reason: "title_missing",
    });
    product = parseProductHtml(html, canonicalUrl);
  }

  logStage(options, "html_parse", parseStartedAt, {
    asin: product.asin,
    title: product.title,
    imageCount: product.images.length,
    priceFound: false,
    priceSkipped: true,
    reason: "price_requires_localized_buybox",
  });

  const postcode = getScrapePostcode(options.postcode);
  const postcodeStartedAt = Date.now();
  const postcodeResult = await setAmazonDeliveryPostcodeDirect(
    canonicalUrl,
    postcode,
    cookieJar,
    html
  );
  logStage(options, "postcode_set", postcodeStartedAt, {
    postcode,
    attempts: postcodeResult.attempts,
    lastStatus: postcodeResult.lastStatus,
    responseConfirmed: postcodeResult.responseConfirmed,
    tokenFound: postcodeResult.tokenFound,
  });

  let localizedHtml: string;
  try {
    const refetchStartedAt = Date.now();
    localizedHtml = await fetchAmazonHtml(
      canonicalUrl,
      PRODUCT_FETCH_TIMEOUT_MS,
      canonicalUrl,
      cookieJar
    );
    logStage(options, "page_fetch", refetchStartedAt, {
      canonicalUrl,
      bytes: localizedHtml.length,
      localized: true,
    });
  } catch (error) {
    if (options.allowMetadataOnly) {
      logStage(options, "price_extract", Date.now(), {
        asin: product.asin,
        localized: false,
        price: null,
        priceFound: false,
        priceSkipped: true,
        reason: "localized_refetch_failed_metadata_only",
      });
      return product;
    }

    throw error;
  }

  const postcodeVerified = verifyAmazonDeliveryPostcode(
    localizedHtml,
    postcode
  );
  const postcodeApplied =
    postcodeResult.responseConfirmed || postcodeVerified;

  const localizedParseStartedAt = Date.now();
  let localizedProduct: ScrapedProduct;
  try {
    localizedProduct = parseProductHtml(localizedHtml, canonicalUrl);
  } catch (error) {
    if (options.allowMetadataOnly) {
      logStage(options, "price_extract", Date.now(), {
        asin: product.asin,
        localized: false,
        price: null,
        priceFound: false,
        priceSkipped: true,
        reason: "localized_parse_failed_metadata_only",
      });
      return product;
    }

    throw error;
  }
  logStage(options, "html_parse", localizedParseStartedAt, {
    asin: localizedProduct.asin,
    title: localizedProduct.title,
    imageCount: localizedProduct.images.length,
    priceFound: false,
    priceSkipped: true,
    reason: "price_extracted_by_localized_buybox_only",
    localized: true,
    postcodeApplied,
    postcodeResponseConfirmed: postcodeResult.responseConfirmed,
    postcodeVerified,
  });

  product.title = localizedProduct.title || product.title;
  product.fullTitle = localizedProduct.fullTitle || product.fullTitle;
  product.description = localizedProduct.description || product.description;
  product.images =
    localizedProduct.images.length > 0 ? localizedProduct.images : product.images;
  product.category = localizedProduct.category || product.category;
  product.itemSpecifics =
    Object.keys(localizedProduct.itemSpecifics).length > 0
      ? localizedProduct.itemSpecifics
      : product.itemSpecifics;
  product.variantName = localizedProduct.variantName ?? product.variantName;
  product.asin = localizedProduct.asin || product.asin;
  product.brand = localizedProduct.brand || product.brand;

  if (!product.description && !options.allowMetadataOnly) {
    throw new AmazonDirectScrapeError(
      "Amazon did not provide About this item or Product Description content. No draft was created.",
      422,
      "AMAZON_DESCRIPTION_MISSING",
    );
  }

  const priceStartedAt = Date.now();
  let priceChoices = extractLocalizedBuyboxPriceChoices(
    load(localizedHtml),
    product.asin
  );
  const hasExplicitMode = options.priceTrackingMode !== undefined;
  const requestedMode = normalizeAmazonPriceTrackingMode(
    options.priceTrackingMode
  );
  let buyboxPrice = hasExplicitMode
    ? requestedMode === "DEAL"
      ? priceChoices.deal
      : priceChoices.regular
    : priceChoices.regular ?? priceChoices.deal;
  let priceRetryAttempted = false;
  let renderedFallbackAttempted = false;
  let renderedFallbackPrice: number | null = null;
  let renderedFallbackError: string | null = null;

  if (!buyboxPrice && !options.allowMetadataOnly) {
    priceRetryAttempted = true;

    try {
      const retryStartedAt = Date.now();
      const retryHtml = await fetchAmazonHtml(
        getAmazonProductRetryUrl(canonicalUrl),
        PRODUCT_FETCH_TIMEOUT_MS,
        canonicalUrl,
        cookieJar
      );
      logStage(options, "page_fetch", retryStartedAt, {
        canonicalUrl,
        bytes: retryHtml.length,
        localized: true,
        retry: true,
        reason: "buybox_price_missing",
      });

      const retryProduct = parseProductHtml(retryHtml, canonicalUrl);
      const retryChoices = extractLocalizedBuyboxPriceChoices(
        load(retryHtml),
        retryProduct.asin || product.asin
      );
      const retryBuyboxPrice = hasExplicitMode
        ? requestedMode === "DEAL"
          ? retryChoices.deal
          : retryChoices.regular
        : retryChoices.regular ?? retryChoices.deal;

      if (retryBuyboxPrice) {
        priceChoices = retryChoices;
        buyboxPrice = retryBuyboxPrice;
      }
    } catch {
      // Preserve the clear missing-buybox result after the bounded retry.
    }
  }

  if (
    !buyboxPrice &&
    !options.allowMetadataOnly &&
    options.resolveMissingPrice
  ) {
    renderedFallbackAttempted = true;

    try {
      const resolvedPrice = await options.resolveMissingPrice({
        asin: product.asin,
        postcode,
        priceTrackingMode: requestedMode,
      });

      if (
        typeof resolvedPrice === "number" &&
        Number.isFinite(resolvedPrice) &&
        resolvedPrice > 0
      ) {
        renderedFallbackPrice = resolvedPrice;
      }
    } catch (error) {
      renderedFallbackError =
        error instanceof Error ? error.message : "Rendered price lookup failed";
    }
  }

  const availableModes = [
    priceChoices.regular ? "REGULAR" : null,
    priceChoices.deal ? "DEAL" : null,
  ].filter(Boolean);
  logStage(options, "price_extract", priceStartedAt, {
    asin: product.asin,
    localized: true,
    price: buyboxPrice?.price ?? renderedFallbackPrice,
    priceFound: buyboxPrice !== null || renderedFallbackPrice !== null,
    priceSource:
      buyboxPrice?.priceSource ??
      (renderedFallbackPrice !== null
        ? "rendered_selected_variant_buybox"
        : "localized_buybox"),
    requestedMode,
    selectedMode:
      buyboxPrice?.mode ??
      (renderedFallbackPrice !== null ? requestedMode : null),
    availableModes,
    priceRetryAttempted,
    renderedFallbackAttempted,
    renderedFallbackError,
    postcodeApplied,
    postcodeResponseConfirmed: postcodeResult.responseConfirmed,
    postcodeVerified,
    selector: buyboxPrice?.selector ?? null,
    containerSelector: buyboxPrice?.containerSelector ?? null,
  });

  product.priceChoices = toScrapedPriceChoices(priceChoices);

  if (!buyboxPrice && renderedFallbackPrice === null) {
    if (options.allowMetadataOnly) {
      return product;
    }

    throw new AmazonDirectScrapeError(
      "Amazon product was found, but ListFlow could not read the selected variant buybox price after checking delivery location. No draft was created.",
      422,
      "AMAZON_BUYBOX_PRICE_MISSING"
    );
  }

  if (buyboxPrice) {
    product.price = buyboxPrice.price;
    product.amazonPriceTrackingMode = buyboxPrice.mode;
  } else {
    product.price = renderedFallbackPrice;
    product.amazonPriceTrackingMode = requestedMode;
    product.priceChoices[requestedMode === "DEAL" ? "deal" : "regular"] = {
      price: renderedFallbackPrice!,
      label: getAmazonPriceTrackingLabel(requestedMode),
    };
  }

  if (product.images.length === 0) {
    throw new AmazonDirectScrapeError(
      "Amazon product was found, but ListFlow could not read a product image. No draft was created.",
      422,
      "AMAZON_IMAGE_MISSING"
    );
  }

  return product;
}
