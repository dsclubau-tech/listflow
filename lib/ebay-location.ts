import type { ItemSpecificsRecord } from "@/lib/item-specifics";
import auPostcodesData from "@/data/au-postcodes.json";

type AuPostcodeEntry = {
  suburbs: string[];
  state: string;
};

const AU_POSTCODES = auPostcodesData as Record<string, AuPostcodeEntry>;

type IndexedAuEntry = {
  postcode: string;
  suburbs: string[];
  state: string;
  lowerSuburbs: { name: string; lower: string }[];
};

// Pre-index entries and lowercased names at module load for fast, allocation-free searches
const AU_POSTCODE_ENTRIES: IndexedAuEntry[] = Object.entries(AU_POSTCODES).map(
  ([postcode, entry]) => ({
    postcode,
    suburbs: entry.suburbs,
    state: entry.state,
    lowerSuburbs: entry.suburbs.map((sub) => ({
      name: sub,
      lower: sub.toLowerCase(),
    })),
  }),
);

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

export function getSuburbsForAuPostcode(
  postalCode: unknown,
): { suburbs: string[]; state: string } | null {
  const normalizedPostalCode = normalizeText(postalCode).toUpperCase();
  if (!normalizedPostalCode) return null;
  const paddedCode = normalizedPostalCode.padStart(4, "0");
  const entry = AU_POSTCODES[paddedCode] || AU_POSTCODES[normalizedPostalCode];
  if (!entry || entry.suburbs.length === 0) return null;
  return {
    suburbs: entry.suburbs,
    state: entry.state,
  };
}

export function getZipcodeLocationText(
  postalCode: unknown,
  country: unknown = "Australia",
  preferredSuburb?: unknown,
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
      if (typeof preferredSuburb === "string" && preferredSuburb.trim()) {
        const cleanPreferred = preferredSuburb.trim().toLowerCase();
        const matched = entry.suburbs.find((sub) => {
          const lowerSub = sub.toLowerCase();
          return (
            lowerSub === cleanPreferred ||
            cleanPreferred === `${lowerSub}, ${entry.state.toLowerCase()}` ||
            cleanPreferred.startsWith(`${lowerSub},`) ||
            cleanPreferred.startsWith(lowerSub)
          );
        });
        if (matched) {
          return `${matched}, ${entry.state}`;
        }
      }
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

  for (let i = 0; i < AU_POSTCODE_ENTRIES.length; i++) {
    if (results.length >= limit) break;
    const entry = AU_POSTCODE_ENTRIES[i];

    if (isNumeric) {
      if (entry.postcode.startsWith(cleanQuery)) {
        // For exact postcode match or 3-4 digit query, expand all suburbs
        if (entry.postcode === cleanQuery || cleanQuery.length >= 3) {
          for (let j = 0; j < entry.suburbs.length; j++) {
            if (results.length >= limit) break;
            const sub = entry.suburbs[j];
            results.push({
              postcode: entry.postcode,
              suburb: sub,
              state: entry.state,
              locationText: `${sub}, ${entry.state}`,
              allSuburbs: entry.suburbs,
            });
          }
        } else {
          results.push({
            postcode: entry.postcode,
            suburb: entry.suburbs[0],
            state: entry.state,
            locationText: `${entry.suburbs[0]}, ${entry.state}`,
            allSuburbs: entry.suburbs,
          });
        }
      }
    } else {
      for (let j = 0; j < entry.lowerSuburbs.length; j++) {
        if (results.length >= limit) break;
        const subObj = entry.lowerSuburbs[j];
        if (subObj.lower.includes(cleanQuery)) {
          results.push({
            postcode: entry.postcode,
            suburb: subObj.name,
            state: entry.state,
            locationText: `${subObj.name}, ${entry.state}`,
            allSuburbs: entry.suburbs,
          });
        }
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
  const isCountryOnly = isCountryOnlyLocation(providedLocation, metadata);
  const zipcodeLocation = getZipcodeLocationText(
    postalCode,
    metadata.code,
    !isCountryOnly ? providedLocation : undefined,
  );
  const location =
    providedLocation && !isCountryOnly
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
