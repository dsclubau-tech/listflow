import { applyEbayLocationMetadata, getEbayCountryMetadata, getZipcodeLocationText } from "@/lib/ebay-location";
import type { ItemSpecificsRecord } from "@/lib/item-specifics";

type Defaults = { defaultCountry?: string | null; defaultZipcode?: string | null; defaultLocationText?: string | null };

export function resolveProductListingLocation(specifics: ItemSpecificsRecord, defaults: Defaults) {
  const country = specifics._Country || defaults.defaultCountry || "Australia";
  const postcode = specifics._PostalCode || defaults.defaultZipcode || "3170";
  const supplied = specifics._Location?.trim() || "";
  const metadata = getEbayCountryMetadata(country);
  if (metadata.code !== "AU") {
    return { specifics: applyEbayLocationMetadata(specifics, {
      country, postalCode: postcode, location: defaults.defaultLocationText,
    }), error: null, code: null };
  }

  const incomplete = !supplied || supplied.toLowerCase() === postcode.toLowerCase() ||
    [metadata.code, metadata.label, ...metadata.aliases].some((value) => value.toLowerCase() === supplied.toLowerCase());
  const saved = defaults.defaultLocationText?.trim() || "";
  const matchesDefaults = getEbayCountryMetadata(defaults.defaultCountry).code === metadata.code &&
    defaults.defaultZipcode?.trim() === postcode.trim();
  const location = incomplete && matchesDefaults ? saved : supplied;
  const canonical = getZipcodeLocationText(postcode, country, location);
  if (!canonical) {
    return {
      specifics,
      error: incomplete
        ? `Choose a product listing suburb for postcode ${postcode} in Supplier Settings.`
        : `The product listing suburb does not match postcode ${postcode}.`,
      code: incomplete ? "LISTING_LOCATION_REQUIRED" : "LISTING_LOCATION_INVALID",
    };
  }
  return { specifics: applyEbayLocationMetadata({ ...specifics, _Location: canonical }, {
    country, postalCode: postcode, location: canonical,
  }), error: null, code: null };
}
