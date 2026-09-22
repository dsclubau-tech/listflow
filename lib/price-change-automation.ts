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

/**
 * A supplier price decrease is safe to apply when the price calculation has
 * already produced the new absolute target. Keeping this decision in one
 * helper prevents callers from applying percentage adjustments repeatedly on
 * retries.
 */
export function shouldAutomaticallyApplyPriceDecrease(
  previousBuyPrice: number,
  nextBuyPrice: number,
) {
  if (!Number.isFinite(previousBuyPrice) || !Number.isFinite(nextBuyPrice)) {
    return false;
  }

  return toCents(nextBuyPrice) < toCents(previousBuyPrice);
}

export function shouldAutomaticallyApplyPriceChange(
  previousBuyPrice: number,
  nextBuyPrice: number,
) {
  return (
    shouldAutomaticallyApplyPriceIncrease(previousBuyPrice, nextBuyPrice) ||
    shouldAutomaticallyApplyPriceDecrease(previousBuyPrice, nextBuyPrice)
  );
}

export function canAutomaticallyApplyTrackedPriceChange(input: {
  promotedAdStatus?: string | null;
  promotedAdRateStrategy?: string | null;
}) {
  // A dynamic promoted-ad rate is unknown until eBay syncs it. Keep the
  // change pending so the worker never claims a margin it cannot verify.
  return !(
    input.promotedAdStatus === "PROMOTED" &&
    input.promotedAdRateStrategy === "DYNAMIC"
  );
}
