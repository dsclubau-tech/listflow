import {
  isAmazonPriceTrackingMode,
  normalizeAmazonPriceTrackingMode,
  type AmazonPriceTrackingMode,
} from "./amazon-price-tracking";

export type AmazonPriceSelection = {
  requestedMode: AmazonPriceTrackingMode;
  effectiveMode: AmazonPriceTrackingMode;
  isFallback: boolean;
  observedAt: string;
};

export const AMAZON_REGULAR_PRICE_FALLBACK_LABEL = "Using Regular Price temporarily";

type PriceSelectionObservation = {
  id: string;
  requestedAsin: string | null;
  selectedAsin: string | null;
  identityOutcome: string | null;
  buyBoxOutcome: string | null;
  postcodeVerified: boolean;
  isSuccessful: boolean;
  eligibleOffer: boolean;
  priceMode: unknown;
  price: unknown;
  regularPrice: unknown;
  dealPrice: unknown;
  observedAt: Date;
};

function cents(value: unknown): number | null {
  if (value == null) return null;
  const amount = Number(String(value));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

/** Only the product's committed, current, verified observation can describe its price. */
export function getAmazonPriceSelection(product: {
  asin: string | null;
  amazonPriceTrackingMode: unknown;
  amazonPrice: unknown;
  lastPriceCheck?: Date | null;
  holdLastObservationId?: string | null;
  priceCheckError?: string | null;
  priceCheckFailureCode?: string | null;
}, observation: PriceSelectionObservation | null | undefined): AmazonPriceSelection | null {
  if (!observation || !product.asin || product.priceCheckError || product.priceCheckFailureCode ||
      observation.id !== product.holdLastObservationId || !product.lastPriceCheck ||
      observation.observedAt.getTime() !== product.lastPriceCheck.getTime() ||
      observation.requestedAsin !== product.asin || observation.selectedAsin !== product.asin ||
      observation.identityOutcome !== "MATCH" || observation.buyBoxOutcome !== "AVAILABLE" ||
      !observation.postcodeVerified || !observation.isSuccessful || !observation.eligibleOffer ||
      !isAmazonPriceTrackingMode(observation.priceMode)) return null;

  const requestedMode = normalizeAmazonPriceTrackingMode(product.amazonPriceTrackingMode);
  const effectiveMode = observation.priceMode;
  const selectedPrice = cents(observation.price);
  const offerPrice = cents(effectiveMode === "DEAL" ? observation.dealPrice : observation.regularPrice);
  if (selectedPrice === null || offerPrice !== selectedPrice || cents(product.amazonPrice) !== selectedPrice ||
      (requestedMode === "REGULAR" && effectiveMode !== "REGULAR")) return null;
  const isFallback = requestedMode === "DEAL" && effectiveMode === "REGULAR";
  // A regular result is not a fallback if a separate deal was actually available.
  if (isFallback && observation.dealPrice != null) return null;
  return { requestedMode, effectiveMode, isFallback, observedAt: observation.observedAt.toISOString() };
}
