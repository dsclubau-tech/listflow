export interface ProfitTierConfig {
  id?: string;
  tierType?: "LOWER_THAN" | "HIGHER_THAN" | "BETWEEN" | string;
  minPrice?: number | null;
  maxPrice?: number | null;
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

export type NormalizedTier = {
  id?: string;
  tierType: "LOWER_THAN" | "HIGHER_THAN" | "BETWEEN";
  minPrice: number;
  maxPrice: number;
  profitPercent: number;
};

/**
 * Normalizes a tier configuration into a typed rule with minPrice, maxPrice, and tierType.
 */
export function normalizeTier(tier: ProfitTierConfig): NormalizedTier | null {
  const profitPercent = normalizeNumber(tier.profitPercent);
  if (profitPercent <= 0) {
    return null;
  }

  const rawMin = normalizeNumber(tier.minPrice);
  const rawMax = normalizeNumber(tier.maxPrice);
  const rawType = (tier.tierType || "").toUpperCase();

  let tierType: "LOWER_THAN" | "HIGHER_THAN" | "BETWEEN";

  if (rawType === "HIGHER_THAN" || (rawMin > 0 && rawMax <= 0)) {
    tierType = "HIGHER_THAN";
    if (rawMin <= 0) return null;
    return {
      id: tier.id,
      tierType,
      minPrice: rawMin,
      maxPrice: 0,
      profitPercent,
    };
  }

  if (rawType === "BETWEEN" || (rawMin > 0 && rawMax > rawMin)) {
    tierType = "BETWEEN";
    if (rawMin <= 0 || rawMax <= rawMin) return null;
    return {
      id: tier.id,
      tierType,
      minPrice: rawMin,
      maxPrice: rawMax,
      profitPercent,
    };
  }

  // Default: LOWER_THAN
  tierType = "LOWER_THAN";
  if (rawMax <= 0) return null;
  return {
    id: tier.id,
    tierType,
    minPrice: 0,
    maxPrice: rawMax,
    profitPercent,
  };
}

/**
 * Returns the extra tier-based profit percent for a given buy price.
 * Returns 0 if no tier matches or if tiers is empty.
 *
 * Evaluation rules:
 * 1. Specific BETWEEN ranges are evaluated first.
 * 2. LOWER_THAN tiers are evaluated in ascending order of maxPrice (lowest threshold first, buyPrice < maxPrice).
 * 3. HIGHER_THAN tiers are evaluated in descending order of minPrice (highest threshold first, buyPrice >= minPrice).
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

  const normalizedTiers = tiers
    .map(normalizeTier)
    .filter((t): t is NormalizedTier => t !== null);

  if (normalizedTiers.length === 0) {
    return 0;
  }

  // 1. Check BETWEEN tiers
  const betweenTiers = normalizedTiers.filter((t) => t.tierType === "BETWEEN");
  for (const tier of betweenTiers) {
    if (normalizedBuyPrice >= tier.minPrice && normalizedBuyPrice < tier.maxPrice) {
      return tier.profitPercent;
    }
  }

  // 2. Check LOWER_THAN tiers (sorted ascending by maxPrice)
  const lowerThanTiers = normalizedTiers
    .filter((t) => t.tierType === "LOWER_THAN")
    .sort((a, b) => a.maxPrice - b.maxPrice);

  for (const tier of lowerThanTiers) {
    if (normalizedBuyPrice < tier.maxPrice) {
      return tier.profitPercent;
    }
  }

  // 3. Check HIGHER_THAN tiers (sorted descending by minPrice so higher thresholds match first)
  const higherThanTiers = normalizedTiers
    .filter((t) => t.tierType === "HIGHER_THAN")
    .sort((a, b) => b.minPrice - a.minPrice);

  for (const tier of higherThanTiers) {
    if (normalizedBuyPrice >= tier.minPrice) {
      return tier.profitPercent;
    }
  }

  return 0;
}
