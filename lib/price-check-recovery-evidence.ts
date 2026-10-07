import { evaluateAmazonShipping, getCommittedShippingEvidence } from './amazon-shipping-evidence';
import { resolveDeferredPricing, type DeferredPricingProduct } from './ebay-deferred-pricing';
// Used by both queue selection and the worker's final recovery check.
export const priceCheckRecoveryRelations = {
  amazonPriceObservations: {
    orderBy: { observedAt: "desc" },
    take: 5,
    select: {
      id: true,
      identityOutcome: true,
      buyBoxOutcome: true,
      postcodeVerified: true,
      stockLeft: true,
      observedAt: true,
      requestedAsin: true,
      selectedAsin: true,
      verifiedPostcode: true,
      isSuccessful: true,
      priceMode: true,
      shippingEvidence: true,
      price: true,
    },
  },
  _count: {
    select: { priceHistory: { where: { appliedAt: null } } },
  },
  priceHistory: { where: { appliedAt: null }, select: { id: true, variantId: true, newSellPrice: true, newPrice: true } },
  listingOperations: { where: { preparedPayload: { path: ["kind"], equals: "ebay-inventory" } }, select: { requestKey: true, preparedPayload: true } },
} as const;

export function getPriceCheckRecoveryEvidence(product: DeferredPricingProduct & {
  amazonPriceObservations: Array<{
    id: string;
    identityOutcome: string | null;
    buyBoxOutcome: string | null;
    postcodeVerified: boolean;
    stockLeft: number | null;
    observedAt: Date;
    requestedAsin?: string | null;
    selectedAsin?: string | null;
    verifiedPostcode?: string | null;
    isSuccessful?: boolean;
    priceMode?: string | null;
    shippingEvidence?: unknown;
    price?: unknown;
  }>;
  _count: { priceHistory: number };
  lastPriceCheck?: Date | null;
  holdLastObservationId?: string | null;
  asin?: string | null;
  amazonPriceTrackingMode?: string;
}, shippingSettings?: { minProductQuantity?: number; maxShippingDays: number; scrapePostcode: string }, now = new Date()) {
  const latest = product.amazonPriceObservations.find(
    (observation) => observation.id === product.holdLastObservationId,
  );
  const current = Boolean(latest?.observedAt && product.lastPriceCheck &&
    latest.observedAt >= product.lastPriceCheck);
  const deferred = resolveDeferredPricing(product, shippingSettings);
  const priceMismatch = deferred.requests.some(request => {
    const expected = request.localPatch?.buyPrice ?? product.variants?.find(v => v.id === request.variantId)?.buyPrice;
    return !current || !latest?.isSuccessful || !(Number(latest.price) > 0) || Number(expected) !== Number(latest.price);
  });
  return {
    identityOutcome: current ? latest?.identityOutcome ?? null : null,
    buyBoxOutcome: current ? latest?.buyBoxOutcome ?? null : null,
    postcodeVerified: current && latest?.postcodeVerified === true,
    verifiedStockLeft: current && latest?.identityOutcome === "MATCH"
      ? latest.stockLeft : null,
    hasUnappliedPriceChange: Boolean(deferred.error) || priceMismatch || product._count.priceHistory > deferred.coveredHistoryIds.length,
    deferredPriceError: deferred.error ?? (priceMismatch ? "The accepted Amazon price changed. Price review required before restoration." : undefined),
    shippingWithinLimit: Boolean(shippingSettings && evaluateAmazonShipping(
      getCommittedShippingEvidence(product, latest, shippingSettings.scrapePostcode),
      shippingSettings.maxShippingDays, now, true,
    ).outcome === 'WITHIN_LIMIT'),
  };
}
