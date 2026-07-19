import { calculateNetProfit } from "@/lib/variant-pricing";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculatePendingReviewMetrics(input: {
  previousBuyPrice: number;
  newBuyPrice: number;
  newSellPrice: number;
  feesPercent: number | null;
  feesFixed: number | null;
  promotedAdStatus: string;
  promotedAdPercent: number | null;
}) {
  const changeAmount = roundMoney(input.newBuyPrice - input.previousBuyPrice);
  if (input.feesPercent === null || input.feesFixed === null) {
    return { changeAmount, profit: null };
  }

  const promotedAdPercent =
    input.promotedAdStatus === "PROMOTED" &&
    input.promotedAdPercent !== null &&
    Number.isFinite(input.promotedAdPercent)
      ? input.promotedAdPercent
      : 0;

  return {
    changeAmount,
    profit: calculateNetProfit({
      buyPrice: input.newBuyPrice,
      sellPrice: input.newSellPrice,
      feesPercent: input.feesPercent,
      feesFixed: input.feesFixed,
      promotedAdPercent,
    }),
  };
}

export function getLatestPendingReviewHistory<
  T extends { createdAt: Date },
>(histories: T[]) {
  return histories.reduce<T | null>(
    (latest, history) =>
      !latest || history.createdAt.getTime() > latest.createdAt.getTime()
        ? history
        : latest,
    null,
  );
}

export function getEffectiveListingQuantity(
  status: string,
  savedQuantity: number,
) {
  return status === "ON_HOLD" ? 0 : savedQuantity;
}
