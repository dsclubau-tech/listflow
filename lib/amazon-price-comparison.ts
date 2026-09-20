import type { ScrapedAmazonPrice } from "@/lib/amazon-scraper";

export type AmazonPriceComparisonOutcome =
  | { kind: "result"; value: ScrapedAmazonPrice }
  | { kind: "error"; code: string; message: string };

export function normalizeAmazonPriceComparisonOutcome(
  outcome: AmazonPriceComparisonOutcome,
) {
  if (outcome.kind === "error") {
    return {
      kind: outcome.kind,
      code: outcome.code,
      message: outcome.message,
    };
  }

  return {
    kind: outcome.kind,
    price: outcome.value.price,
    rawPrice: outcome.value.rawPrice ?? null,
    shippingPrice: outcome.value.shippingPrice ?? null,
    stockLeft: outcome.value.stockLeft,
    priceMode: outcome.value.priceMode ?? null,
    priceChoices: outcome.value.priceChoices ?? null,
    variantSelectionFailed: outcome.value.variantSelectionFailed ?? false,
    variantSelectionReason: outcome.value.variantSelectionReason ?? null,
    detectedAsin: outcome.value.detectedAsin ?? null,
    asinRedirected: outcome.value.asinRedirected ?? false,
  };
}

export function amazonPriceComparisonOutcomesMatch(
  left: AmazonPriceComparisonOutcome,
  right: AmazonPriceComparisonOutcome,
) {
  return (
    JSON.stringify(normalizeAmazonPriceComparisonOutcome(left)) ===
    JSON.stringify(normalizeAmazonPriceComparisonOutcome(right))
  );
}
