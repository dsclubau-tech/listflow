import type { AmazonPriceTrackingMode } from "./amazon-price-tracking";

export type ShippingConfirmation = { sourceJobId: string; productId: string; nonce: string };
export type UploadShippingContext = { asin: string; mode: AmazonPriceTrackingMode; selectedMode: AmazonPriceTrackingMode; postcode: string; maximum: number };
export type UploadShippingConfirmation = ShippingConfirmation & { message: string };

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readShippingConfirmation(value: unknown): ShippingConfirmation | null {
  const row = record(value);
  return typeof row.sourceJobId === 'string' && typeof row.productId === 'string' && typeof row.nonce === 'string' && Boolean(row.sourceJobId && row.productId && row.nonce)
    ? { sourceJobId: row.sourceJobId, productId: row.productId, nonce: row.nonce } : null;
}
function context(value: unknown): UploadShippingContext | null {
  const row = record(value);
  if (typeof row.asin !== 'string' || !/^[A-Z0-9]{10}$/.test(row.asin) ||
    (row.mode !== 'REGULAR' && row.mode !== 'DEAL') || (row.selectedMode !== 'REGULAR' && row.selectedMode !== 'DEAL') ||
    typeof row.postcode !== 'string' || !/^\d{4}$/.test(row.postcode) || typeof row.maximum !== 'number' || !Number.isInteger(row.maximum) || row.maximum < 1) return null;
  return { asin: row.asin, mode: row.mode, selectedMode: row.selectedMode, postcode: row.postcode, maximum: row.maximum };
}
export function shippingContextsMatch(left: unknown, right: unknown) {
  const a = context(left), b = context(right);
  return Boolean(a && b && a.asin === b.asin && a.mode === b.mode && a.selectedMode === b.selectedMode && a.postcode === b.postcode && a.maximum === b.maximum);
}
export function getUploadShippingApproval(metadata: unknown, productId: string): UploadShippingContext | null {
  return context(record(record(metadata).shippingApprovals)[productId]);
}
