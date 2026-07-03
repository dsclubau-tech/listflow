import type { Product } from "@/app/generated/prisma/client";
import type { EbayCategoryAspect } from "@/lib/ebay";
import { getEbayCategoryAspects } from "@/lib/ebay";
import {
  DEFAULT_MPN,
  inferTypeItemSpecific,
  inferVolumeItemSpecific,
  normalizeItemSpecifics,
  parseMissingItemSpecificNames,
  readItemSpecificValue,
  sanitizeEbayItemSpecifics,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";

export type RequiredItemSpecific = {
  name: string;
  values?: string[];
};

export type RequiredSpecificsValidationResult = {
  itemSpecifics: ItemSpecificsRecord;
  addedItemSpecifics: ItemSpecificsRecord;
  missingItemSpecifics: string[];
  requiredItemSpecifics: RequiredItemSpecific[];
};

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasSpecific(specifics: ItemSpecificsRecord, name: string) {
  return readItemSpecificValue(specifics, [name]) !== null;
}

function addIfMissing(
  specifics: ItemSpecificsRecord,
  added: ItemSpecificsRecord,
  name: string,
  value: string | null | undefined
) {
  const normalizedValue = value?.trim();
  if (!normalizedValue || hasSpecific(specifics, name)) {
    return false;
  }

  specifics[name] = normalizedValue;
  added[name] = normalizedValue;
  return true;
}

function mergeDefaults(
  specifics: ItemSpecificsRecord,
  added: ItemSpecificsRecord,
  defaults: unknown
) {
  const defaultSpecifics = normalizeItemSpecifics(defaults);

  for (const [name, value] of Object.entries(defaultSpecifics)) {
    addIfMissing(specifics, added, name, value);
  }
}

function getRequiredAspects(aspects: EbayCategoryAspect[]) {
  return aspects.filter((aspect) => aspect.required);
}

function isUnavailablePartNumber(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === DEFAULT_MPN.toLowerCase();
}

function readPreferredPartNumber(
  specifics: ItemSpecificsRecord,
  aspectName: string
) {
  const candidates = [
    aspectName,
    "Manufacturer Part Number",
    "Part Number",
    "Model Number",
    "Model name",
    "Model Name",
    "Item model number",
    "Model",
  ];

  for (const candidate of candidates) {
    const value = readItemSpecificValue(specifics, [candidate]);
    if (!isUnavailablePartNumber(value)) {
      return value;
    }
  }

  const mpn = readItemSpecificValue(specifics, ["MPN"]);
  if (!isUnavailablePartNumber(mpn)) {
    return mpn;
  }

  return DEFAULT_MPN;
}

function inferRequiredSpecific(
  product: Product,
  specifics: ItemSpecificsRecord,
  aspect: EbayCategoryAspect
) {
  const aspectName = aspect.name;
  const normalized = normalizeName(aspectName);
  const allSpecificText = Object.entries(specifics)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => `${key}: ${value}`)
    .join(" ");
  const descriptionText = product.description.replace(/<[^>]+>/g, " ");
  const sourceText = [
    product.title,
    product.categoryName,
    descriptionText,
    allSpecificText,
  ];

  if (normalized === "volume" || normalized === "capacity") {
    return inferVolumeItemSpecific(...sourceText);
  }

  if (normalized === "mpn" || normalized === "manufacturer part number") {
    return readPreferredPartNumber(specifics, aspectName);
  }

  if (normalized === "type") {
    return inferTypeItemSpecific({
      title: product.title,
      categoryName: product.categoryName,
      itemSpecifics: specifics,
      allowedValues: aspect.values,
    });
  }

  return null;
}

export async function validateRequiredItemSpecifics(input: {
  product: Product;
  storeNumber: 1 | 2 | 3;
  supplierDefaultItemSpecifics?: unknown;
}): Promise<RequiredSpecificsValidationResult> {
  const specifics = sanitizeEbayItemSpecifics(input.product.itemSpecifics);
  const addedItemSpecifics: ItemSpecificsRecord = {};

  mergeDefaults(
    specifics,
    addedItemSpecifics,
    input.supplierDefaultItemSpecifics
  );

  const aspects = await getEbayCategoryAspects(
    input.product.category,
    input.storeNumber
  );
  const requiredAspects = getRequiredAspects(aspects);
  const requiredItemSpecifics = requiredAspects.map((aspect) => ({
    name: aspect.name,
    values: aspect.values.length > 0 ? aspect.values : undefined,
  }));

  for (const aspect of requiredAspects) {
    addIfMissing(
      specifics,
      addedItemSpecifics,
      aspect.name,
      inferRequiredSpecific(input.product, specifics, aspect)
    );
  }

  const missingItemSpecifics = requiredAspects
    .filter((aspect) => !hasSpecific(specifics, aspect.name))
    .map((aspect) => aspect.name);

  return {
    itemSpecifics: sanitizeEbayItemSpecifics(specifics),
    addedItemSpecifics,
    missingItemSpecifics,
    requiredItemSpecifics,
  };
}

export function buildMissingItemSpecificsResponse(message: string | null | undefined) {
  const missingItemSpecifics = parseMissingItemSpecificNames(message);
  return {
    missingItemSpecifics,
    requiredItemSpecifics: missingItemSpecifics.map((name) => ({ name })),
  };
}
