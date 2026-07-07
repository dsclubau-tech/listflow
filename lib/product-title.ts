export const EBAY_TITLE_MAX_LENGTH = 80;

export function normalizeFullProductTitle(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function toEbayListingTitle(value: string | null | undefined) {
  const normalized = normalizeFullProductTitle(value);
  if (normalized.length <= EBAY_TITLE_MAX_LENGTH) {
    return normalized;
  }

  const shortened = normalized.slice(0, EBAY_TITLE_MAX_LENGTH).replace(/\s+\S*$/, "").trim();
  return shortened || normalized.slice(0, EBAY_TITLE_MAX_LENGTH).trim();
}

export function applyTitleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function getTemplateProductTitle(product: {
  title: string;
  fullTitle?: string | null;
}) {
  return normalizeFullProductTitle(product.fullTitle) || product.title;
}
