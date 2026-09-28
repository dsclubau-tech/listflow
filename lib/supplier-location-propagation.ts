import type { EbayLocationMetadata } from "@/lib/ebay-location";

export function isUnpublishedDraftLocationTarget(input: {
  status: string;
  ebayItemId: string | null;
  activeUpload: boolean;
}) {
  return (input.status === "DRAFT" || input.status === "FAILED") &&
    !input.ebayItemId &&
    !input.activeUpload;
}

export function applyLocationToDraftSpecifics(
  rawSpecifics: unknown,
  location: EbayLocationMetadata,
) {
  const previous =
    rawSpecifics && typeof rawSpecifics === "object" && !Array.isArray(rawSpecifics)
      ? rawSpecifics as Record<string, unknown>
      : {};
  return {
    ...previous,
    _Country: location.country,
    _Currency: location.currency,
    _Location: location.location,
    _PostalCode: location.postalCode,
    _Site: location.site,
  };
}
