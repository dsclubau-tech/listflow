function toCents(value: number) {
  return Math.round(value * 100);
}

export function shouldAutomaticallyApplyPriceIncrease(
  previousBuyPrice: number,
  nextBuyPrice: number,
) {
  if (!Number.isFinite(previousBuyPrice) || !Number.isFinite(nextBuyPrice)) {
    return false;
  }

  return toCents(nextBuyPrice) > toCents(previousBuyPrice);
}
