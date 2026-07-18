import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";

const SKU_ASIN_PATTERN = /(?:^|[^A-Z0-9])(B0[A-Z0-9]{8})(?=$|[^A-Z0-9])/i;
const NAMED_ASIN_PATTERN = /(?:^|[^A-Z0-9])([A-Z0-9]{10})(?=$|[^A-Z0-9])/i;
const ASIN_SPECIFIC_KEYS = new Set([
  "asin",
  "amazonasin",
  "amazonitemid",
  "amazonitemnumber",
]);

function extractPatternAsin(value: string, pattern: RegExp) {
  const match = value.toUpperCase().match(pattern);
  const asin = normalizeAsin(match?.[1]);
  return asin && isValidAsin(asin) ? asin : null;
}

export function extractAsinFromEbaySku(value: string | null | undefined) {
  return value ? extractPatternAsin(value, SKU_ASIN_PATTERN) : null;
}

export function extractAsinFromNamedSpecifics(
  specifics: Record<string, string>,
) {
  for (const [key, value] of Object.entries(specifics)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!ASIN_SPECIFIC_KEYS.has(normalizedKey)) {
      continue;
    }

    const asin = extractPatternAsin(value, NAMED_ASIN_PATTERN);

    if (asin) {
      return asin;
    }
  }

  return null;
}

export function extractAsinFromEbayListingFields(input: {
  listingSku?: string | null;
  variationSkus?: Array<string | null | undefined>;
  itemSpecifics?: Record<string, string>;
}) {
  const listingAsin = extractAsinFromEbaySku(input.listingSku);

  if (listingAsin) {
    return listingAsin;
  }

  for (const sku of input.variationSkus ?? []) {
    const variationAsin = extractAsinFromEbaySku(sku);

    if (variationAsin) {
      return variationAsin;
    }
  }

  return extractAsinFromNamedSpecifics(input.itemSpecifics ?? {});
}

export function resolveImportedListingAsin(input: {
  listingSku?: string | null;
  variationSkus?: Array<string | null | undefined>;
  itemSpecifics?: Record<string, string>;
  persistedAsin?: string | null;
}) {
  const listingAsin = extractAsinFromEbayListingFields(input);

  if (listingAsin) {
    return listingAsin;
  }

  const persistedAsin = normalizeAsin(input.persistedAsin);
  return persistedAsin && isValidAsin(persistedAsin) ? persistedAsin : null;
}
