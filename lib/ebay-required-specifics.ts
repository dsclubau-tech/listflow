import type { Product } from "@/app/generated/prisma/client";
import type { EbayCategoryAspect } from "@/lib/ebay";
import { getEbayCategoryAspects } from "@/lib/ebay";
import {
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

function inferRequiredSpecific(
  product: Product,
  specifics: ItemSpecificsRecord,
  aspectName: string
) {
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
      inferRequiredSpecific(input.product, specifics, aspect.name)
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

