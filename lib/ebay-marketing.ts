export const EBAY_MARKETPLACE_ID = "EBAY_AU" as const;

export function buildEbayMarketingHeaders(
  accessToken: string,
  extraHeaders: Record<string, string> = {},
) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extraHeaders,
    "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
  };
}

export function resolveEbayPromotedBidPercentage(
  rateStrategy: "FIXED" | "DYNAMIC" | "UNKNOWN",
  listingBidPercentage: number | null,
  campaignBidPercentage: number | null,
) {
  if (rateStrategy !== "FIXED") {
    return null;
  }

  return listingBidPercentage ?? campaignBidPercentage;
}
