export function isDuplicateListingError(message: string | null | undefined) {
  return /duplicate listing|already have on ebay|identical items from the same seller/i.test(
    message ?? "",
  );
}

export function extractDuplicateListingItemId(message: string | null | undefined) {
  if (!isDuplicateListingError(message)) {
    return null;
  }

  const text = message ?? "";
  const parenthesizedIds = [...text.matchAll(/\((\d{9,15})\)/g)].map(
    (match) => match[1],
  );
  const parenthesizedId = parenthesizedIds.find(isLikelyEbayItemId);
  if (parenthesizedId) {
    return parenthesizedId;
  }

  const numericIds = [...text.matchAll(/\b(\d{9,15})\b/g)].map(
    (match) => match[1],
  );
  return numericIds.find(isLikelyEbayItemId) ?? null;
}

function isLikelyEbayItemId(value: string | undefined) {
  return Boolean(value && /^\d{9,15}$/.test(value));
}
