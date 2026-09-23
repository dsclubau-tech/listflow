// Used by both queue selection and the worker's final recovery check.
export const priceCheckRecoveryRelations = {
  amazonPriceObservations: {
    orderBy: { observedAt: "desc" },
    take: 1,
    select: {
      identityOutcome: true,
      buyBoxOutcome: true,
      postcodeVerified: true,
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
  }>;
  _count: { priceHistory: number };
}) {
  const latest = product.amazonPriceObservations[0];
  return {
    identityOutcome: latest?.identityOutcome ?? null,
    buyBoxOutcome: latest?.buyBoxOutcome ?? null,
    postcodeVerified: latest?.postcodeVerified === true,
    hasUnappliedPriceChange: product._count.priceHistory > 0,
  };
}
