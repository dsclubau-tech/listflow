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

export function getOnHoldReason(input: {
  holdReason?: string | null;
  priceCheckError: string | null;
  amazonStockLeft: number | null;
  savedQuantity: number;
  lowStockThreshold?: number;
}) {
  const explicitReason = input.holdReason?.trim();
  if (explicitReason) {
    return explicitReason;
  }

  const priceCheckError = input.priceCheckError?.trim();

  if (priceCheckError) {
    return `Automatic hold after failed price check: ${priceCheckError}`;
  }

  if (input.savedQuantity <= 0) {
    return "Listing quantity was set to 0.";
  }

  const lowStockThreshold = input.lowStockThreshold ?? 3;
  if (
    input.amazonStockLeft !== null &&
    input.amazonStockLeft <= lowStockThreshold
  ) {
    return `Low Amazon stock (${input.amazonStockLeft} left).`;
  }

  return "Put on hold manually.";
}

export function getStoredQuantityAfterEdit(
  status: string,
  displayedQuantity: number,
  savedResumeQuantity: number,
) {
  const normalizedDisplayedQuantity = Math.max(
    0,
    Math.floor(displayedQuantity),
  );

  if (status === "ON_HOLD" && normalizedDisplayedQuantity === 0) {
    return Math.max(0, Math.floor(savedResumeQuantity));
  }

  return normalizedDisplayedQuantity;
}

export function hasDisplayedQuantityChanged(
  status: string,
  displayedQuantity: number,
  savedQuantity: number,
) {
  const normalizedDisplayedQuantity = Math.max(
    0,
    Math.floor(displayedQuantity),
  );

  return (
    normalizedDisplayedQuantity !==
    getEffectiveListingQuantity(status, savedQuantity)
  );
}
