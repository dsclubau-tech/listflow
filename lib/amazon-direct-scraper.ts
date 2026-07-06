import "server-only";

import { load, type CheerioAPI } from "cheerio";
import { extractLocalizedBuyboxPrice } from "@/lib/amazon-buybox-price";
import {
  extractAmazonPostcodeToken,
  extractAmazonProductTitle,
  parseAmazonPostcodeResponse,
} from "@/lib/amazon-direct-parse";
import {
  inferBrandItemSpecific,
  inferSizeItemSpecific,
  inferTypeItemSpecific,
  isUsefulItemSpecificCandidate,
} from "@/lib/item-specifics";
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
  onStage?: AmazonScrapeStageLogger;
  postcode?: string;
};

type CheerioSelection = ReturnType<CheerioAPI>;

const PRODUCT_FETCH_TIMEOUT_MS = 12_000;
const POSTCODE_SET_TIMEOUT_MS = 8_000;

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
  "item dimensions d x w x h": "__dimensions__",
  "item dimensions lxwxh": "__dimensions__",
  "item dimensions  lxwxh": "__dimensions__",
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
  if (normalizedPostcode.length !== 4) {
    return false;
  }

  try {
    const token = extractAmazonPostcodeToken(load(pageHtml), pageHtml);
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
        "x-requested-with": "XMLHttpRequest",
        ...(token ? { "anti-csrftoken-a2z": token } : {}),
      },
      cookieJar
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
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

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      if (parseAmazonPostcodeResponse(text, normalizedPostcode)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
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

function parseDimensions(raw: string) {
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
  const clean = url
    .replace(/&amp;/g, "&")
    .replace(/\._[A-Z]{2}\d+_\./, ".")
    .replace(/\._.*?_\./, ".");

  return /^https?:\/\//i.test(clean) ? clean : "";
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

function extractImages($: CheerioAPI, html: string) {
  const images: string[] = [];

  $("img[data-a-dynamic-image]").each((_, image) => {
    extractDynamicImageUrls($(image).attr("data-a-dynamic-image")).forEach((url) =>
      addImage(images, url)
    );
  });

  addImage(images, $("#landingImage").attr("data-old-hires"));
  addImage(images, $("#landingImage").attr("src"));
  addImage(images, $("#imgTagWrapperId img").attr("src"));
  addImage(images, $('meta[property="og:image"]').attr("content"));

  const colorImageMatch = html.match(
    /'colorImages':\s*\{[^}]*'initial':\s*(\[[\s\S]*?\])\s*\}/
  );
  if (colorImageMatch) {
    try {
      const parsed = JSON.parse(colorImageMatch[1]) as Array<{
        hiRes?: string;
        large?: string;
        main?: string | Record<string, string>;
      }>;
      for (const image of parsed) {
        addImage(
          images,
          image.hiRes ||
            image.large ||
            (typeof image.main === "string" ? image.main : "")
        );
      }
    } catch {
      // Keep selector-based images.
    }
  }

  $("#altImages img").each((_, image) => {
    addImage(images, $(image).attr("src"));
  });

  return images;
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

  return normalizeItemSpecificsForEbay(specs);
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
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "image"; src: string; alt: string };

function collectListItems($: CheerioAPI, root: CheerioSelection) {
  return root
    .find("li")
    .map((_, item) => normalizeText($(item).text()))
    .get()
    .filter((item) => item && !/^make sure this fits/i.test(item));
}

function collectDescriptionBlocks($: CheerioAPI) {
  const blocks: DescriptionBlock[] = [];
  const seenText = new Set<string>();
  const seenImages = new Set<string>();

  function pushText(type: "heading" | "paragraph", text: string) {
    const normalized = normalizeText(text);
    const key = `${type}:${normalized.toLowerCase()}`;
    if (!normalized || seenText.has(key)) {
      return;
    }
    seenText.add(key);
    blocks.push({ type, text: normalized });
  }

  function pushList(items: string[]) {
    const normalized = Array.from(new Set(items.map(normalizeText).filter(Boolean)));
    if (normalized.length > 0) {
      blocks.push({ type: "list", items: normalized });
    }
  }

  function pushImage(src: string | null | undefined, alt: string | null | undefined) {
    const image = normalizeImageUrl(normalizeText(src));
    if (!image || seenImages.has(image)) {
      return;
    }
    seenImages.add(image);
    blocks.push({ type: "image", src: image, alt: normalizeText(alt) });
  }

  const featureItems = collectListItems($, $("#feature-bullets"));
  if (featureItems.length > 0) {
    pushText("heading", "About this item");
    pushList(featureItems);
  }

  $("#productDescription p, #productDescription span").each((_, item) => {
    pushText("paragraph", $(item).text());
  });

  $("#aplus h1, #aplus h2, #aplus h3, #aplus_feature_div h1, #aplus_feature_div h2, #aplus_feature_div h3").each(
    (_, item) => {
      pushText("heading", $(item).text());
    }
  );

  $("#aplus p, #aplus .a-size-base, #aplus_feature_div p, #aplus_feature_div .a-size-base").each(
    (_, item) => {
      pushText("paragraph", $(item).text());
    }
  );

  $("#aplus img, #aplus_feature_div img").each((_, image) => {
    pushImage(
      $(image).attr("data-src") || $(image).attr("src"),
      $(image).attr("alt")
    );
  });

  return blocks;
}

function renderDescription($: CheerioAPI, title: string) {
  const blocks = collectDescriptionBlocks($);

  if (blocks.length === 0) {
    blocks.push({ type: "heading", text: title });
  }

  const rendered = blocks
    .map((block) => {
      if (block.type === "heading") {
        return `<div style="margin:16px 0 10px;font-size:22px;font-weight:700;line-height:1.35;color:#ef3b2d;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
          block.text
        )}</div>`;
      }

      if (block.type === "paragraph") {
        return `<div style="margin:0 0 14px;font-size:16px;line-height:1.75;color:#333;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
          block.text
        )}</div>`;
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
  const rawTitle = extractAmazonProductTitle($, html);
  const title = rawTitle.length > 80 ? rawTitle.slice(0, 80).replace(/\s+\S*$/, "") : rawTitle;

  if (!title) {
    throw new AmazonDirectScrapeError(
      "Could not read the Amazon product title. No draft was created.",
      422,
      "AMAZON_TITLE_MISSING"
    );
  }

  const asin = extractAsin($, canonicalUrl, html);
  const images = extractImages($, html);
  const description = renderDescription($, title);
  const rawItemSpecifics = extractItemSpecifics($);
  const category = extractCategory($);
  const variantName = extractVariantName($);
  const brand = extractBrand($, rawItemSpecifics);
  const itemSpecifics = withInferredItemSpecifics(rawItemSpecifics, title, {
    brand,
    categoryName: category,
    variantName,
  });

  return {
    title,
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
  } satisfies ScrapedProduct;
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
  const html = await fetchAmazonHtml(
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
  const product = parseProductHtml(html, canonicalUrl);
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
  const postcodeApplied = await setAmazonDeliveryPostcodeDirect(
    canonicalUrl,
    postcode,
    cookieJar,
    html
  );
  logStage(options, "postcode_set", postcodeStartedAt, {
    postcode,
    applied: postcodeApplied,
  });

  if (!postcodeApplied) {
    throw new AmazonDirectScrapeError(
      "Could not set the Amazon AU delivery postcode. No draft was created.",
      422,
      "AMAZON_POSTCODE_FAILED"
    );
  }

  const refetchStartedAt = Date.now();
  const localizedHtml = await fetchAmazonHtml(
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

  const localizedParseStartedAt = Date.now();
  const localizedProduct = parseProductHtml(localizedHtml, canonicalUrl);
  logStage(options, "html_parse", localizedParseStartedAt, {
    asin: localizedProduct.asin,
    title: localizedProduct.title,
    imageCount: localizedProduct.images.length,
    priceFound: false,
    priceSkipped: true,
    reason: "price_extracted_by_localized_buybox_only",
    localized: true,
  });

  product.title = localizedProduct.title || product.title;
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

  const priceStartedAt = Date.now();
  const buyboxPrice = extractLocalizedBuyboxPrice(
    load(localizedHtml),
    product.asin
  );
  logStage(options, "price_extract", priceStartedAt, {
    asin: product.asin,
    localized: true,
    price: buyboxPrice?.price ?? null,
    priceFound: buyboxPrice !== null,
    priceSource: buyboxPrice?.priceSource ?? "localized_buybox",
    selector: buyboxPrice?.selector ?? null,
    containerSelector: buyboxPrice?.containerSelector ?? null,
  });

  if (!buyboxPrice) {
    throw new AmazonDirectScrapeError(
      "Amazon product was found, but ListFlow could not read the selected variant buybox price. No draft was created.",
      422,
      "AMAZON_BUYBOX_PRICE_MISSING"
    );
  }

  product.price = buyboxPrice.price;

  if (product.images.length === 0) {
    throw new AmazonDirectScrapeError(
      "Amazon product was found, but ListFlow could not read a product image. No draft was created.",
      422,
      "AMAZON_IMAGE_MISSING"
    );
  }

  return product;
}
