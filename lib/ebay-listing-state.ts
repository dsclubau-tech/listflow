const REVISABLE_EBAY_LISTING_STATUSES = new Set(["IMPORTED", "ON_HOLD"]);

export function hasRevisableEbayListing(input: {
  status: string;
  ebayItemId: string | null | undefined;
}) {
  return (
    REVISABLE_EBAY_LISTING_STATUSES.has(input.status) &&
    Boolean(input.ebayItemId?.trim())
  );
}
