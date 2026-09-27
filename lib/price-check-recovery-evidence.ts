// Used by both queue selection and the worker's final recovery check.
export const priceCheckRecoveryRelations = {
  amazonPriceObservations: {
    orderBy: { observedAt: "desc" },
    take: 1,
    select: {
      identityOutcome: true,
      buyBoxOutcome: true,
      postcodeVerified: true,
      stockLeft: true,
      observedAt: true,
    },
  },
  _count: {
    select: { priceHistory: { where: { appliedAt: null } } },
  },
} as const;

export function getPriceCheckRecoveryEvidence(product: {
  amazonPriceObservations: Array<{
    identityOutcome: string | null;
    buyBoxOutcome: string | null;
    postcodeVerified: boolean;
    stockLeft: number | null;
    observedAt: Date;
  }>;
  _count: { priceHistory: number };
  lastPriceCheck?: Date | null;
}) {
  const latest = product.amazonPriceObservations[0];
  const current = Boolean(latest?.observedAt && product.lastPriceCheck &&
    latest.observedAt >= product.lastPriceCheck);
  return {
    identityOutcome: current ? latest?.identityOutcome ?? null : null,
    buyBoxOutcome: current ? latest?.buyBoxOutcome ?? null : null,
    postcodeVerified: current && latest?.postcodeVerified === true,
    verifiedStockLeft: current && latest?.identityOutcome === "MATCH"
      ? latest.stockLeft : null,
    hasUnappliedPriceChange: product._count.priceHistory > 0,
  };
}
