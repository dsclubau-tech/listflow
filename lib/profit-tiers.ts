export interface ProfitTierConfig {
  id?: string;
  maxPrice: number;
  profitPercent: number;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

/**
 * Returns the extra tier-based profit percent for a given buy price.
 * Returns 0 if no tier matches or if tiers is empty.
 * Tiers are evaluated lowest-threshold-first (ascending maxPrice); first match where buyPrice < maxPrice wins.
 */
export function getTierProfitPercent(
  buyPrice: number,
  tiers?: ProfitTierConfig[] | null,
): number {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return 0;
  }

  const normalizedBuyPrice = normalizeNumber(buyPrice);
  if (normalizedBuyPrice <= 0) {
    return 0;
  }

  const validTiers = tiers
    .map((tier) => ({
      id: tier.id,
      maxPrice: normalizeNumber(tier.maxPrice),
      profitPercent: normalizeNumber(tier.profitPercent),
    }))
    .filter((tier) => tier.maxPrice > 0 && tier.profitPercent > 0)
    .sort((a, b) => a.maxPrice - b.maxPrice);

  for (const tier of validTiers) {
    if (normalizedBuyPrice < tier.maxPrice) {
      return tier.profitPercent;
    }
  }

  return 0;
}
