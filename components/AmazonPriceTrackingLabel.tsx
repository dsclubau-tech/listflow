import { getAmazonPriceTrackingLabel, normalizeAmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import { AMAZON_REGULAR_PRICE_FALLBACK_LABEL, type AmazonPriceSelection } from "@/lib/amazon-price-selection";

export default function AmazonPriceTrackingLabel({ mode, selection }: {
  mode: unknown;
  selection?: AmazonPriceSelection | null;
}) {
  const requestedMode = normalizeAmazonPriceTrackingMode(mode);
  return (
    <span>
      {getAmazonPriceTrackingLabel(requestedMode)}
      {requestedMode === "DEAL" && selection?.requestedMode === "DEAL" && selection.isFallback && (
        <span className="mt-0.5 block text-amber-700">{AMAZON_REGULAR_PRICE_FALLBACK_LABEL}</span>
      )}
    </span>
  );
}
