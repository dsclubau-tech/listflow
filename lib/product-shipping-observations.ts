import { prisma } from "./prisma";
import type { ShippingDisplayObservation } from "./amazon-shipping-display";

export const shippingObservationSelect = {
  id: true, stockLeft: true, requestedAsin: true, selectedAsin: true, identityOutcome: true,
  buyBoxOutcome: true, acceptedPriceSource: true, postcodeVerified: true, isSuccessful: true,
  eligibleOffer: true, priceMode: true, price: true, regularPrice: true, dealPrice: true,
  observedAt: true, shippingEvidence: true, verifiedPostcode: true,
} as const;

/** One scoped batch for committed observations that fell outside the recent window. */
export async function loadMissingCommittedShippingObservations(products: Array<{
  id: string; storeId: string; holdLastObservationId: string | null;
  amazonPriceObservations: ShippingDisplayObservation[];
}>) {
  const missing = products.filter(product => product.holdLastObservationId &&
    !product.amazonPriceObservations.some(row => row.id === product.holdLastObservationId));
  const rows = missing.length ? await prisma.amazonPriceObservation.findMany({
    where: { OR: missing.map(product => ({ id: product.holdLastObservationId!, productId: product.id, storeId: product.storeId })) },
    select: shippingObservationSelect,
  }) : [];
  return new Map(rows.map(row => [row.id, row]));
}
