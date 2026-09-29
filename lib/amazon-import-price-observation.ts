import type { AmazonBuyboxPriceChoices, AmazonBuyboxPriceResult } from "@/lib/amazon-buybox-price";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";

export type ImportPriceObservation = {
  source: "localized" | "retry" | "rendered";
  asin: string | null;
  identityOutcome?: "MATCH" | "MISMATCH" | "UNKNOWN";
  postcodeVerified: boolean;
  buyBoxOutcome: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  choices: AmazonBuyboxPriceChoices;
};

export function selectImportPriceObservation(
  observations: ImportPriceObservation[],
  asin: string,
  mode: AmazonPriceTrackingMode,
  explicitMode: boolean,
) {
  let latest: ImportPriceObservation | null = null;
  for (const observation of observations) {
    if (observation.asin?.toUpperCase() !== asin.toUpperCase() ||
        observation.identityOutcome === "MISMATCH" || !observation.postcodeVerified) continue;
    if (observation.buyBoxOutcome === "UNAVAILABLE" ||
        (observation.buyBoxOutcome === "AVAILABLE" &&
          (observation.choices.regular || observation.choices.deal))) {
      latest = observation;
    }
  }
  const choice: AmazonBuyboxPriceResult | null = latest?.buyBoxOutcome === "AVAILABLE"
    ? explicitMode
      ? mode === "DEAL" ? latest.choices.deal : latest.choices.regular
      : latest.choices.regular ?? latest.choices.deal
    : null;
  return { observation: latest, choice };
}
