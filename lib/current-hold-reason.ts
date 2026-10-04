import type { AmazonShippingStatus } from "./amazon-shipping-evidence";
export interface CurrentHoldReasonInput {
  amazonShippingStatus?: AmazonShippingStatus;
  status: string;
  holdOrigin?: string | null;
  holdReason?: string | null;
  priceCheckError?: string | null;
  priceCheckFailureCode?: string | null;
  lastPriceCheck?: Date | string | null;
  amazonStockLeft?: number | null;
  amazonAvailability?: string | null;
  savedQuantity: number;
  minimumProductQuantity: number;
  hasPendingReview?: boolean;
  asin?: string | null;
  latestObservation?: {
    requestedAsin?: string | null;
    identityOutcome?: string | null;
    stockLeft?: number | null;
    observedAt: Date | string;
  } | null;
}

export function resolveCurrentHoldReason(input: CurrentHoldReasonInput) {
  const latestCheckAt = input.lastPriceCheck
    ? new Date(input.lastPriceCheck).toISOString()
    : null;
  const error = input.priceCheckError?.trim() || null;
  const manualOrUnknown = !input.holdOrigin ||
    input.holdOrigin === "MANUAL" ||
    input.holdOrigin === "UNKNOWN" ||
    input.holdOrigin === "PRICE_CHECK_UNSAFE_PRICE";
  const stockObservation = input.latestObservation;
  const observedAt = stockObservation
    ? new Date(stockObservation.observedAt).getTime()
    : 0;
  const verifiedStock =
    latestCheckAt &&
    stockObservation &&
    observedAt >= new Date(latestCheckAt).getTime() &&
    stockObservation.identityOutcome === "MATCH" &&
    (!input.asin || stockObservation.requestedAsin?.toUpperCase() === input.asin.toUpperCase()) &&
    stockObservation.stockLeft !== null &&
    stockObservation.stockLeft !== undefined
      ? stockObservation.stockLeft
      : null;
  const latestCheckMessage = error
    ? input.priceCheckFailureCode === "TECHNICAL_ERROR"
      ? `Latest check could not verify Amazon: ${error}`
      : `Latest price check failed: ${error}`
    : latestCheckAt
      ? verifiedStock === null && input.holdOrigin === "LOW_STOCK"
        ? "Latest check could not verify Amazon stock."
        : "Latest Amazon check completed."
      : null;

  let currentHoldReason: string | null = null;
  if (input.status === "ON_HOLD") {
    if (manualOrUnknown) {
      currentHoldReason = input.holdReason?.trim() ||
        (input.holdOrigin === "UNKNOWN" || input.holdOrigin === "PRICE_CHECK_UNSAFE_PRICE"
          ? "Hold needs review before release."
          : input.savedQuantity <= 0
            ? "Listing quantity was set to 0."
            : "Put on hold manually.");
    } else if (error) {
      currentHoldReason = input.priceCheckFailureCode === "TECHNICAL_ERROR"
        ? `Latest check could not verify Amazon: ${error} The hold remains.`
        : `Automatic hold after failed price check: ${error}`;
    } else if (verifiedStock !== null && verifiedStock < input.minimumProductQuantity) {
      currentHoldReason =
        `Low Amazon stock (${verifiedStock} left; minimum ${input.minimumProductQuantity}).`;
    } else if (input.hasPendingReview) {
      currentHoldReason = "Price change awaiting review; listing remains on hold.";
    } else if (input.holdOrigin === "LOW_STOCK" && verifiedStock === null && latestCheckAt) {
      currentHoldReason = "Amazon stock could not be verified; low-stock hold remains.";
    } else if (input.amazonShippingStatus && input.amazonShippingStatus.outcome !== "WITHIN_LIMIT") {
      currentHoldReason = `${input.amazonShippingStatus.message} The hold remains.`;
    } else if (latestCheckAt) {
      currentHoldReason = "Latest Amazon check passed; restoration on eBay is pending.";
    } else {
      currentHoldReason = input.holdReason?.trim() || "Automatic hold; waiting for a fresh Amazon check.";
    }
  }
  return { currentHoldReason, latestCheckAt, latestCheckMessage };
}
