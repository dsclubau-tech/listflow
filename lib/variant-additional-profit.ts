import {
  calculateProfitFixedFromSellPrice,
  calculateSellPrice,
} from "@/lib/variant-pricing";
import { getTierProfitPercent, type ProfitTierConfig } from "@/lib/profit-tiers";

function normalizeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function addAdditionalProfitToExistingVariant(input: {
  buyPrice: number;
  sellPrice: number;
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
  additionalProfitPercent: number;
  additionalProfitFixed: number;
  roundCents: number | null;
  profitTiers?: ProfitTierConfig[] | null;
}) {
  const existingProfitFixed = calculateProfitFixedFromSellPrice({
    buyPrice: input.buyPrice,
    sellPrice: input.sellPrice,
    feesPercent: input.feesPercent,
    feesFixed: input.feesFixed,
    profitPercent: input.profitPercent,
  });
  const tierProfitPercent = input.profitTiers
    ? getTierProfitPercent(input.buyPrice, input.profitTiers)
    : 0;
  const profitPercent =
    normalizeNumber(input.profitPercent) +
    Math.max(0, normalizeNumber(input.additionalProfitPercent)) +
    tierProfitPercent;
  const profitFixed =
    existingProfitFixed +
    Math.max(0, normalizeNumber(input.additionalProfitFixed));
  const sellPrice = calculateSellPrice({
    buyPrice: input.buyPrice,
    feesPercent: input.feesPercent,
    feesFixed: input.feesFixed,
    profitPercent,
    profitFixed,
    roundCents: input.roundCents,
    minimumProfit: null,
  });

  return {
    existingProfitFixed: roundMoney(existingProfitFixed),
    profitPercent: roundMoney(profitPercent),
    profitFixed: roundMoney(profitFixed),
    sellPrice: roundMoney(sellPrice),
  };
}
