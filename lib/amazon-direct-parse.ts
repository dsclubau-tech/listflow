import type { CheerioAPI } from "cheerio";

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function extractFirstAttribute(
  $: CheerioAPI,
  selectors: string[],
  attribute: string
) {
  for (const selector of selectors) {
    const value = normalizeText($(selector).first().attr(attribute));
    if (value) {
      return value;
    }
  }

  return "";
}

function normalizeAmazonTitle(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\s*:\s*Amazon\.com\.au:.*$/i, "")
    .replace(/\s*-\s*Amazon\.com\.au$/i, "")
    .trim();
}

function getJsonLdValues(value: unknown): unknown[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(getJsonLdValues);
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [record, ...getJsonLdValues(record["@graph"])];
}

function extractJsonLdTitle($: CheerioAPI) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, script) => $(script).text())
    .get();

  for (const script of scripts) {
    try {
      const values = getJsonLdValues(JSON.parse(script));
      for (const value of values) {
        const record = value as Record<string, unknown>;
        const type = Array.isArray(record["@type"])
          ? record["@type"].join(" ")
          : String(record["@type"] ?? "");
        const name = typeof record.name === "string" ? record.name : "";

        if (name && /product/i.test(type)) {
          return normalizeAmazonTitle(name);
        }
      }
    } catch {
      // Keep selector and metadata fallbacks available.
    }
  }

  return "";
}

function extractDocumentTitle($: CheerioAPI) {
  const title = normalizeAmazonTitle(extractFirstText($, ["title"]));

  if (
    !title ||
    /^(?:amazon\.com\.au|robot check|page not found|sorry!?|something went wrong)$/i.test(
      title
    )
  ) {
    return "";
  }

  return title;
}

export function extractAmazonProductTitle($: CheerioAPI, html = "") {
  return (
    normalizeAmazonTitle(extractFirstText($, ["#productTitle", "#title h1"])) ||
    normalizeAmazonTitle(
      extractFirstAttribute(
        $,
        [
          'meta[property="og:title"]',
          'meta[name="title"]',
          'meta[name="twitter:title"]',
        ],
        "content"
      )
    ) ||
    extractJsonLdTitle($) ||
    extractDocumentTitle($) ||
    normalizeAmazonTitle(
      html.match(/"productTitle"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\"/g, '"')
    )
  );
}

export function extractAmazonPostcodeToken($: CheerioAPI, html = "") {
  const token =
    extractFirstAttribute(
      $,
      [
        'input[name="anti-csrftoken-a2z"]',
        'meta[name="anti-csrftoken-a2z"]',
        'input[name="csrfToken"]',
        'meta[name="csrf-token"]',
      ],
      "value"
    ) ||
    extractFirstAttribute(
      $,
      [
        'input[name="anti-csrftoken-a2z"]',
        'meta[name="anti-csrftoken-a2z"]',
        'input[name="csrfToken"]',
        'meta[name="csrf-token"]',
      ],
      "content"
    );

  if (token) {
    return token;
  }

  return (
    html.match(/anti-csrftoken-a2z["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    html.match(/csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    null
  );
}

export function parseAmazonPostcodeResponse(
  responseText: string,
  postcode: string
) {
  const normalizedPostcode = postcode.replace(/\D/g, "").slice(0, 4);
  const trimmed = responseText.trim().replace(/^\)\]\}',?\s*/, "");

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const flattened = JSON.stringify(parsed);
    return (
      parsed.isValidAddress === 1 ||
      parsed.isValidAddress === "1" ||
      parsed.isValidAddress === "true" ||
      parsed.isValidAddress === true ||
      parsed.isDefault === 1 ||
      parsed.isDefault === "1" ||
      parsed.isDefault === "true" ||
      parsed.isDefault === true ||
      flattened.includes(normalizedPostcode)
    );
  } catch {
    return (
      /"isValidAddress"\s*:\s*(?:1|true|"1"|"true")/i.test(responseText) ||
      /"isDefault"\s*:\s*(?:1|true|"1"|"true")/i.test(responseText) ||
      responseText.includes(normalizedPostcode)
    );
  }
}
