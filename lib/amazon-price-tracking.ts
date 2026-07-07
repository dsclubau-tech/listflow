export const AMAZON_PRICE_TRACKING_MODES = ["REGULAR", "DEAL"] as const;

export type AmazonPriceTrackingMode =
  (typeof AMAZON_PRICE_TRACKING_MODES)[number];

export const DEFAULT_AMAZON_PRICE_TRACKING_MODE: AmazonPriceTrackingMode =
  "REGULAR";

export function normalizeAmazonPriceTrackingMode(
  value: unknown
): AmazonPriceTrackingMode {
  return value === "DEAL" ? "DEAL" : DEFAULT_AMAZON_PRICE_TRACKING_MODE;
}

export function isAmazonPriceTrackingMode(
  value: unknown
): value is AmazonPriceTrackingMode {
  return value === "REGULAR" || value === "DEAL";
}

export function getAmazonPriceTrackingLabel(
  mode: AmazonPriceTrackingMode
): string {
  return mode === "DEAL" ? "Deal price" : "Regular price";
}

export function getAmazonPriceUnavailableMessage(
  mode: AmazonPriceTrackingMode
): string {
  return mode === "DEAL"
    ? "Deal price is no longer available on Amazon."
    : "Regular price is no longer available on Amazon.";
}
