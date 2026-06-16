export const DEFAULT_MPN = "Does not apply";
export const DEFAULT_MODEL = "Does not apply";
export const DEFAULT_BRAND = "Unbranded";

const EBAY_ITEM_SPECIFIC_VALUE_MAX_LENGTH = 65;

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
