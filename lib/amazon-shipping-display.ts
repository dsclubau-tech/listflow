import { evaluateAmazonShipping, getCommittedShippingEvidence, readAmazonShippingEvidence, SHIPPING_EVIDENCE_MAX_AGE_MS, type AmazonShippingStatus } from "./amazon-shipping-evidence";
import { resolveAmazonDeliveryPostcode } from "./amazon-delivery-postcode";

export type AmazonShippingDisplay = { state: "QUIET" | "UNVERIFIED" | "OVER_LIMIT"; message: string | null };
type ShippingProduct = Parameters<typeof getCommittedShippingEvidence>[0] & { priceCheckError?: string | null };
export type ShippingDisplayObservation = NonNullable<Parameters<typeof getCommittedShippingEvidence>[1]> & {
  eligibleOffer?: boolean; price?: unknown; dealPrice?: unknown; stockLeft?: number | null;
};
const unverified = (): AmazonShippingDisplay => ({ state: "UNVERIFIED", message: "Amazon delivery time is unverified. Retry the shipping check." });

/** Presentation only. Never use this result to authorize a marketplace action. */
export function getAmazonShippingDisplay(product: ShippingProduct, observations: ShippingDisplayObservation[],
  postcode: string, maximum: number, now = new Date()): AmazonShippingDisplay {
  // Inspect the latest attempt, including unknown/failed attempts. Never search backwards for a success.
  const latest = [...observations].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
  const evidence = readAmazonShippingEvidence(latest?.shippingEvidence);
  if (!latest || !evidence || latest.isSuccessful !== true || latest.eligibleOffer !== true ||
      !Number.isFinite(Number(latest.price)) || Number(latest.price) <= 0 || latest.stockLeft === 0 ||
      latest.requestedAsin !== product.asin || latest.selectedAsin !== product.asin || evidence.asin !== product.asin ||
      latest.identityOutcome !== "MATCH" || latest.buyBoxOutcome !== "AVAILABLE" || !latest.postcodeVerified ||
      latest.verifiedPostcode !== postcode || evidence.postcode !== postcode || evidence.mode !== latest.priceMode ||
      Date.parse(evidence.observedAt) !== latest.observedAt.getTime() ||
      (product.amazonPriceTrackingMode !== "DEAL" && evidence.mode !== "REGULAR") ||
      (product.amazonPriceTrackingMode === "DEAL" && evidence.mode === "REGULAR" && latest.dealPrice != null) ||
      (product.priceCheckError && product.lastPriceCheck && product.lastPriceCheck.getTime() > latest.observedAt.getTime())) return unverified();
  const status = evaluateAmazonShipping(evidence, maximum, now, false);
  if (status.outcome === "WITHIN_LIMIT") return { state: "QUIET", message: null };
  if (status.outcome === "OVER_LIMIT") return { state: "OVER_LIMIT",
    message: now.getTime() - latest.observedAt.getTime() > SHIPPING_EVIDENCE_MAX_AGE_MS
      ? `The last verified Amazon delivery exceeded your ${status.maxShippingDays}-day limit. Recheck delivery.`
      : status.message };
  return unverified();
}

export function getAmazonShippingDisplayMessage(display: AmazonShippingDisplay | null | undefined,
  operational: AmazonShippingStatus | null | undefined): string | null {
  return display ? display.state === "QUIET" ? null : display.message :
    operational && operational.outcome !== "WITHIN_LIMIT" ? operational.message : null;
}

/** Shared list/detail projection; operational status continues to require the committed observation and freshness. */
export function getProductShippingPresentation<T extends ShippingDisplayObservation>(product: ShippingProduct,
  observations: T[], settings: { scrapePostcode: string; maxShippingDays: number } | null,
  now = new Date()) {
  const currentObservation = observations.find(row => row.id === product.holdLastObservationId) ?? null;
  const postcode = resolveAmazonDeliveryPostcode(settings?.scrapePostcode), maximum = settings?.maxShippingDays ?? 25;
  return {
    currentObservation,
    amazonShippingStatus: product.asin ? evaluateAmazonShipping(getCommittedShippingEvidence(product, currentObservation, postcode), maximum, now, true) : undefined,
    amazonShippingDisplay: product.asin ? getAmazonShippingDisplay(product, observations, postcode, maximum, now) : undefined,
  };
}
