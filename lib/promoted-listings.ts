export const MIN_PROMOTED_AD_RATE = 2;
export const MAX_PROMOTED_AD_RATE = 100;
export const MAX_PROMOTED_LISTING_JOB_SIZE = 2000;

export function normalizePromotedAdRate(value: unknown) {
  const rate = Number(value);
  if (
    !Number.isFinite(rate) ||
    rate < MIN_PROMOTED_AD_RATE ||
    rate > MAX_PROMOTED_AD_RATE ||
    Math.abs(rate * 10 - Math.round(rate * 10)) >= 1e-9
  ) {
    return null;
  }

  return rate;
}

export function normalizePromotedListingProductIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
}

export function normalizePromotedCampaignInput(value: unknown) {
  const campaign =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const mode =
    campaign.mode === "CREATE"
      ? "CREATE"
      : campaign.mode === "EXISTING"
        ? "EXISTING"
        : null;
  const campaignId =
    typeof campaign.campaignId === "string" ? campaign.campaignId.trim() : "";
  const campaignName =
    typeof campaign.campaignName === "string"
      ? campaign.campaignName.trim()
      : "";

  if (mode === "EXISTING" && campaignId) {
    return { mode, campaignId, campaignName: "" } as const;
  }
  if (mode === "CREATE" && campaignName.length >= 1 && campaignName.length <= 80) {
    return { mode, campaignId: "", campaignName } as const;
  }

  return null;
}
