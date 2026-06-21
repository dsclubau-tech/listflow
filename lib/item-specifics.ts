export const DEFAULT_MPN = "Does not apply";
export const DEFAULT_MODEL = "Does not apply";
export const DEFAULT_BRAND = "Unbranded";

const EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH = 65;
export const EBAY_LISTING_ITEM_SPECIFIC_MAX_COUNT = 30;

const HIGH_PRIORITY_ITEM_SPECIFICS = [
  "Brand",
  "Type",
  "MPN",
  "Model",
  "Colour",
  "Color",
  "Size",
  "Material",
  "Item Length",
  "Item Width",
  "Item Height",
  "Item Weight",
  "Features",
  "Compatible Brand",
  "Compatible Model",
  "Connectivity",
  "Power Source",
  "Voltage",
  "Wattage",
  "Number of Items",
  "Style",
  "Pattern",
  "Shape",
  "Finish",
  "Room",
  "Department",
] as const;

const LOW_VALUE_ITEM_SPECIFICS = new Set([
  "asin",
  "best sellers rank",
  "batteries",
  "batteries included",
  "batteries required",
  "country of origin",
  "customer reviews",
  "date first available",
  "is discontinued by manufacturer",
  "manufacturer",
]);

const ITEM_SPECIFIC_PRIORITY = new Map(
  HIGH_PRIORITY_ITEM_SPECIFICS.map((name, index) => [
    name.trim().toLowerCase(),
    index,
  ]),
);

export type ItemSpecificsRecord = Record<string, string>;

function hasItemSpecific(specifics: ItemSpecificsRecord, name: string) {
  const normalizedName = name.trim().toLowerCase();
  return Object.keys(specifics).some(
    (key) => key.trim().toLowerCase() === normalizedName
  );
}

function getItemSpecificValue(specifics: ItemSpecificsRecord, names: string[]) {
  const normalizedNames = new Set(names.map((name) => name.trim().toLowerCase()));

  for (const [key, value] of Object.entries(specifics)) {
    if (normalizedNames.has(key.trim().toLowerCase())) {
      return value;
    }
  }

  return null;
}

function normalizeSpecificName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isLowValueSpecificName(name: string) {
  return LOW_VALUE_ITEM_SPECIFICS.has(normalizeSpecificName(name));
}

function truncateItemSpecificValue(value: string) {
  if (value.length <= EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH) {
    return value;
  }

  const hardLimit = value.slice(0, EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH).trim();
  const lastSeparator = Math.max(
    hardLimit.lastIndexOf(","),
    hardLimit.lastIndexOf(";"),
    hardLimit.lastIndexOf("/")
  );

  if (lastSeparator >= 20) {
    return hardLimit.slice(0, lastSeparator).trim();
  }

  const lastSpace = hardLimit.lastIndexOf(" ");
  if (lastSpace >= 20) {
    return hardLimit.slice(0, lastSpace).trim();
  }

  return hardLimit;
}

export function normalizeItemSpecifics(value: unknown): ItemSpecificsRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const specifics: ItemSpecificsRecord = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || rawValue === null || rawValue === undefined) {
      continue;
    }

    const normalizedValue =
      typeof rawValue === "string" ? rawValue.trim() : String(rawValue).trim();
    if (!normalizedValue) {
      continue;
    }

    specifics[normalizedKey] = normalizedValue;
  }

  return specifics;
}

export function ensureMpnItemSpecifics(value: unknown): ItemSpecificsRecord {
  const specifics = normalizeItemSpecifics(value);

  if (!hasItemSpecific(specifics, "MPN")) {
    specifics.MPN = DEFAULT_MPN;
  }

  return specifics;
}

export function sanitizeEbayItemSpecifics(value: unknown): ItemSpecificsRecord {
  const specifics = ensureMpnItemSpecifics(value);
  const model =
    getItemSpecificValue(specifics, ["Model", "Model Number", "Item Model Number"]) ||
    DEFAULT_MODEL;

  if (!hasItemSpecific(specifics, "Model")) {
    specifics.Model = model;
  }

  if (!hasItemSpecific(specifics, "Brand")) {
    specifics.Brand = DEFAULT_BRAND;
  }

  const sanitized: ItemSpecificsRecord = {};

  for (const [rawKey, rawValue] of Object.entries(specifics)) {
    const key = rawKey.trim();
    const value = rawValue.trim().replace(/\s+/g, " ");

    if (!key || !value) {
      continue;
    }

    sanitized[key] = key.startsWith("_")
      ? value
      : truncateItemSpecificValue(value);
  }

  return sanitized;
}

export function getListingItemSpecifics(
  value: unknown,
  defaultType: string,
  maxCount = EBAY_LISTING_ITEM_SPECIFIC_MAX_COUNT,
): ItemSpecificsRecord {
  const specifics = sanitizeEbayItemSpecifics(value);

  if (!hasItemSpecific(specifics, "Type")) {
    specifics.Type = defaultType || "Other";
  }

  const seen = new Set<string>();
  const entries = Object.entries(specifics)
    .map(([rawKey, rawValue], originalIndex) => ({
      key: rawKey.trim(),
      value: rawValue.trim(),
      originalIndex,
    }))
    .filter(({ key, value }) => {
      if (!key || !value || key.startsWith("_") || isLowValueSpecificName(key)) {
        return false;
      }

      const normalizedName = normalizeSpecificName(key);
      if (seen.has(normalizedName)) {
        return false;
      }

      seen.add(normalizedName);
      return true;
    })
    .sort((a, b) => {
      const aPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(a.key)) ?? 1000;
      const bPriority =
        ITEM_SPECIFIC_PRIORITY.get(normalizeSpecificName(b.key)) ?? 1000;

      return aPriority - bPriority || a.originalIndex - b.originalIndex;
    })
    .slice(0, Math.max(1, maxCount));

  return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
}
