import type { ItemSpecificsRecord } from "@/lib/item-specifics";

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

const AU_POSTCODE_LOCATIONS: Record<string, string> = {
  "2000": "Sydney, NSW",
  "3000": "Melbourne, VIC",
  "3170": "Mulgrave, VIC",
  "4000": "Brisbane, QLD",
  "5000": "Adelaide, SA",
  "6000": "Perth, WA",
  "7000": "Hobart, TAS",
};

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
    return AU_POSTCODE_LOCATIONS[normalizedPostalCode] ?? "";
  }

  return "";
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
