import type { CheerioAPI } from "cheerio";

const LOW_STOCK_PATTERN = /only\s+(\d+)\s+left\s+in\s+stock/i;
const USED_CONDITION_PATTERN =
  /\b(?:used|pre-owned|renewed|refurbished|acceptable|very good|like new)\b/i;
const NEW_CONDITION_PATTERN = /\bbuy\s+new\b|\bnew\b/i;

const EXPLICIT_NEW_OFFER_SELECTORS = [
  "#newAccordionRow",
  '[id^="newAccordionRow"]',
  '[id*="newAccordionRow"]',
] as const;

const CONDITION_ROW_SELECTORS = [
  "#buybox .a-accordion-row",
  "#desktop_buybox .a-accordion-row",
  "#apex_desktop .a-accordion-row",
  "#buybox [data-a-accordion-row]",
  "#desktop_buybox [data-a-accordion-row]",
] as const;

const GENERIC_AVAILABILITY_SELECTORS = [
  "#availability",
  "#mir-layout-DELIVERY_BLOCK",
] as const;

const CONDITION_ANCESTOR_SELECTOR = [
  '[id*="AccordionRow"]',
  ".a-accordion-row",
  "[data-a-accordion-row]",
].join(",");

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseLowStockCount(value: string) {
  const match = normalizeText(value).match(LOW_STOCK_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNewOfferText(value: string) {
  const normalized = normalizeText(value);
  return (
    NEW_CONDITION_PATTERN.test(normalized) &&
    !USED_CONDITION_PATTERN.test(normalized)
  );
}

/**
 * Returns the limited stock count for Amazon's New offer only.
 *
 * A null result means the New offer does not advertise a limited quantity.
 * Used, renewed, and refurbished offer rows must never contribute stock.
 */
export function extractAmazonNewOfferStockLeft($: CheerioAPI): number | null {
  const explicitNewOfferTexts: string[] = [];
  const seenExplicitElements = new Set<unknown>();

  for (const selector of EXPLICIT_NEW_OFFER_SELECTORS) {
    $(selector).each((_, element) => {
      if (seenExplicitElements.has(element)) return;
      seenExplicitElements.add(element);

      const text = normalizeText($(element).text());
      if (text) explicitNewOfferTexts.push(text);
    });
  }

  if (explicitNewOfferTexts.length > 0) {
    for (const text of explicitNewOfferTexts) {
      const stockLeft = parseLowStockCount(text);
      if (stockLeft !== null) return stockLeft;
    }

    return null;
  }

  const inferredNewOfferTexts: string[] = [];
  const seenConditionRows = new Set<unknown>();

  for (const selector of CONDITION_ROW_SELECTORS) {
    $(selector).each((_, element) => {
      if (seenConditionRows.has(element)) return;
      seenConditionRows.add(element);

      const text = normalizeText($(element).text());
      if (text && isNewOfferText(text)) inferredNewOfferTexts.push(text);
    });
  }

  if (inferredNewOfferTexts.length > 0) {
    for (const text of inferredNewOfferTexts) {
      const stockLeft = parseLowStockCount(text);
      if (stockLeft !== null) return stockLeft;
    }

    return null;
  }

  const seenAvailabilityElements = new Set<unknown>();

  for (const selector of GENERIC_AVAILABILITY_SELECTORS) {
    let stockLeft: number | null = null;

    $(selector).each((_, element) => {
      if (stockLeft !== null || seenAvailabilityElements.has(element)) return;
      seenAvailabilityElements.add(element);

      const conditionAncestor = $(element).closest(CONDITION_ANCESTOR_SELECTOR);
      const conditionText = normalizeText(conditionAncestor.text());
      if (
        conditionText &&
        USED_CONDITION_PATTERN.test(conditionText) &&
        !isNewOfferText(conditionText)
      ) {
        return;
      }

      stockLeft = parseLowStockCount($(element).text());
    });

    if (stockLeft !== null) return stockLeft;
  }

  return null;
}
