import type { ItemSpecificsRecord } from "@/lib/item-specifics";
import auPostcodesData from "@/data/au-postcodes.json";

type AuPostcodeEntry = {
  suburbs: string[];
  state: string;
};

const AU_POSTCODES = auPostcodesData as Record<string, AuPostcodeEntry>;

export type AuPostcodeSuggestion = {
  postcode: string;
  suburb: string;
  state: string;
  locationText: string;
  allSuburbs: string[];
};

type CountryMetadata = {
  aliases: string[];
  code: string;
  currency: string;
  defaultLocation: string;
  defaultPostalCode: string;
  label: string;
  site: string;
};

export type EbayLocationMetadata = {
  country: string;
  currency: string;
  location: string;
  postalCode: string;
  site: string;
};

const COUNTRY_METADATA: CountryMetadata[] = [
  {
    aliases: ["australia", "au", "aus"],
    code: "AU",
    currency: "AUD",
    defaultLocation: "Mulgrave, VIC",
    defaultPostalCode: "3170",
    label: "Australia",
    site: "Australia",
  },
  {
    aliases: ["united states", "us", "usa", "united states of america"],
    code: "US",
    currency: "USD",
    defaultLocation: "New York, NY",
    defaultPostalCode: "10001",
    label: "United States",
    site: "US",
  },
  {
    aliases: ["united kingdom", "uk", "gb", "great britain"],
    code: "GB",
    currency: "GBP",
    defaultLocation: "London",
    defaultPostalCode: "SW1A 1AA",
    label: "United Kingdom",
    site: "UK",
  },
  {
    aliases: ["canada", "ca"],
    code: "CA",
    currency: "CAD",
    defaultLocation: "Toronto, ON",
    defaultPostalCode: "M5V 2T6",
    label: "Canada",
    site: "Canada",
  },
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeLookup(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function getEbayCountryMetadata(country: unknown = "Australia") {
  const lookup = normalizeLookup(country);

  return (
    COUNTRY_METADATA.find(
      (metadata) =>
        metadata.aliases.includes(lookup) ||
        metadata.code.toLowerCase() === lookup ||
        metadata.label.toLowerCase() === lookup,
    ) ?? COUNTRY_METADATA[0]
  );
}

export function getEbayCountryLabel(country: unknown = "Australia") {
  return getEbayCountryMetadata(country).label;
}

export function getZipcodeLocationText(
  postalCode: unknown,
  country: unknown = "Australia",
) {
  const metadata = getEbayCountryMetadata(country);
  const normalizedPostalCode = normalizeText(postalCode).toUpperCase();

  if (!normalizedPostalCode) {
    return "";
  }

  if (metadata.code === "AU") {
    // Standardize 4-digit AU postcode formatting with leading zeros if needed
    const paddedCode = normalizedPostalCode.padStart(4, "0");
    const entry = AU_POSTCODES[paddedCode] || AU_POSTCODES[normalizedPostalCode];
    if (entry && entry.suburbs.length > 0) {
      return `${entry.suburbs[0]}, ${entry.state}`;
    }
  }

  return "";
}

export function searchAuPostcodes(
  query: string,
  limit: number = 20,
): AuPostcodeSuggestion[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return [];

  const results: AuPostcodeSuggestion[] = [];
  const isNumeric = /^\d+$/.test(cleanQuery);

  for (const [postcode, entry] of Object.entries(AU_POSTCODES)) {
    if (results.length >= limit) break;

    if (isNumeric) {
      if (postcode.startsWith(cleanQuery)) {
        // For exact postcode match or 3-4 digit query, expand all suburbs
        if (postcode === cleanQuery || cleanQuery.length >= 3) {
          for (const sub of entry.suburbs) {
            if (results.length >= limit) break;
            results.push({
              postcode,
              suburb: sub,
              state: entry.state,
              locationText: `${sub}, ${entry.state}`,
              allSuburbs: entry.suburbs,
            });
          }
        } else {
          results.push({
            postcode,
            suburb: entry.suburbs[0],
            state: entry.state,
            locationText: `${entry.suburbs[0]}, ${entry.state}`,
            allSuburbs: entry.suburbs,
          });
        }
      }
    } else {
      const matchingSuburbs = entry.suburbs.filter((sub) =>
        sub.toLowerCase().includes(cleanQuery),
      );
      for (const matchingSuburb of matchingSuburbs) {
        if (results.length >= limit) break;
        results.push({
          postcode,
          suburb: matchingSuburb,
          state: entry.state,
          locationText: `${matchingSuburb}, ${entry.state}`,
          allSuburbs: entry.suburbs,
        });
      }
    }
  }

  return results;
}

function isCountryOnlyLocation(value: string, metadata: CountryMetadata) {
  const lookup = value.toLowerCase();

  return (
    metadata.aliases.includes(lookup) ||
    COUNTRY_METADATA.some(
      (country) =>
        country.label.toLowerCase() === lookup ||
        country.code.toLowerCase() === lookup,
    )
  );
}

export function resolveEbayLocationMetadata(input?: {
  country?: unknown;
  currency?: unknown;
  location?: unknown;
  postalCode?: unknown;
  site?: unknown;
}): EbayLocationMetadata {
  const metadata = getEbayCountryMetadata(input?.country);
  const postalCode =
    normalizeText(input?.postalCode).toUpperCase() || metadata.defaultPostalCode;
  const providedLocation = normalizeText(input?.location);
  const zipcodeLocation = getZipcodeLocationText(postalCode, metadata.code);
  const location =
    providedLocation && !isCountryOnlyLocation(providedLocation, metadata)
      ? providedLocation
      : zipcodeLocation || postalCode || metadata.defaultLocation;

  return {
    country: metadata.code,
    currency: normalizeText(input?.currency) || metadata.currency,
    location,
    postalCode,
    site: normalizeText(input?.site) || metadata.site,
  };
}

export function applyEbayLocationMetadata(
  itemSpecifics: ItemSpecificsRecord,
  defaults?: {
    country?: unknown;
    location?: unknown;
    postalCode?: unknown;
  },
): ItemSpecificsRecord {
  const metadata = resolveEbayLocationMetadata({
    country: itemSpecifics._Country || defaults?.country,
    currency: itemSpecifics._Currency,
    location: itemSpecifics._Location || defaults?.location,
    postalCode: itemSpecifics._PostalCode || defaults?.postalCode,
    site: itemSpecifics._Site,
  });

  return {
    ...itemSpecifics,
    _Country: metadata.country,
    _Currency: metadata.currency,
    _Location: metadata.location,
    _PostalCode: metadata.postalCode,
    _Site: metadata.site,
  };
}
