import { load } from "cheerio";

export type AmazonImportPageQuality = {
  kind: "PRODUCT" | "TEMPORARY_ERROR" | "CHALLENGE" | "UNRECOGNIZED";
  asin: string | null;
  title: string | null;
};

const TEMPORARY_TITLE = /^(?:server busy|service unavailable|internal server error|temporarily unavailable|too many requests|503(?: service unavailable)?|something went wrong)[\s.!-]*$/i;
const CHALLENGE_TITLE = /^(?:robot check|captcha|verify you are a human)[\s.!-]*$/i;

export function isInvalidAmazonImportTitle(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const title = value.trim().replace(/\s*:\s*Amazon\.com\.au:.*$/i, "");
  return !title || TEMPORARY_TITLE.test(title) || CHALLENGE_TITLE.test(title);
}

export function classifyAmazonImportPage(html: string): AmazonImportPageQuality {
  const $ = load(html);
  const titles = [
    $("#productTitle").first().text(),
    $("#title h1").first().text(),
    $('meta[property="og:title"]').attr("content"),
    $('meta[name="title"]').attr("content"),
    $("title").first().text(),
  ].map((value) => (value ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const bodyStart = $("body").text().replace(/\s+/g, " ").trim().slice(0, 200);
  const asinCandidates = [
    $("#ASIN").first().attr("value"),
    $('input[name="ASIN"]').first().attr("value"),
    $('[data-asin][id*="detail"], [data-asin][id*="product"]').first().attr("data-asin"),
    $('[data-asin]').first().attr("data-asin"),
  ];
  const asin = asinCandidates
    .map((value) => value?.trim().toUpperCase() ?? "")
    .find((value) => /^[A-Z0-9]{10}$/.test(value)) ?? null;
  const title = titles[0] ?? null;
  if (titles.some((value) => CHALLENGE_TITLE.test(value)) ||
      /enter the characters you see below|not a robot|captcha/i.test(bodyStart)) {
    return { kind: "CHALLENGE", asin, title };
  }
  if (titles.some((value) => TEMPORARY_TITLE.test(value)) ||
      (!asin && TEMPORARY_TITLE.test(bodyStart))) {
    return { kind: "TEMPORARY_ERROR", asin, title };
  }
  const productMarker = $("#productTitle, #title h1, #landingImage, #feature-bullets, #corePrice_feature_div, #buybox").length > 0;
  return { kind: asin && productMarker && title && !isInvalidAmazonImportTitle(title)
    ? "PRODUCT" : "UNRECOGNIZED", asin, title };
}

export function validateAmazonImportResult(value: unknown):
  { code: "AMAZON_IMPORT_METADATA_INVALID"; message: string } | null {
  if (!value || typeof value !== "object") {
    return { code: "AMAZON_IMPORT_METADATA_INVALID", message: "Amazon import returned no usable product details. Please retry." };
  }
  const result = value as Record<string, unknown>;
  if (isInvalidAmazonImportTitle(result.title) ||
      (result.fullTitle !== undefined && result.fullTitle !== null && isInvalidAmazonImportTitle(result.fullTitle)) ||
      typeof result.asin !== "string" || !/^[A-Z0-9]{10}$/i.test(result.asin)) {
    return { code: "AMAZON_IMPORT_METADATA_INVALID", message: "Amazon returned an error page instead of valid product details. Please retry the import; no draft was saved." };
  }
  return null;
}
