export function uniqueCompletedProductIds(
  productIds: string[],
  completedProductIds: Iterable<string>,
) {
  const completed = new Set(completedProductIds);
  return productIds.filter((productId) => completed.has(productId));
}

export function clampCompletedPriceCheckCount(checked: number, total: number) {
  const safeTotal = Math.max(0, total);
  return Math.min(Math.max(0, Math.trunc(checked)), safeTotal);
}
