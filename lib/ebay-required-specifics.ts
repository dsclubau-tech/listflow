import type { Product } from "@/app/generated/prisma/client";
import type { EbayCategoryAspect } from "@/lib/ebay";
import { getEbayCategoryAspects } from "@/lib/ebay";
import {
  parseMissingItemSpecificNames,
  sanitizeEbayItemSpecifics,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";
import {
  resolveRequiredItemSpecifics,
  type RequiredSpecificDecision,
} from "@/lib/required-specific-resolver";

export type RequiredItemSpecific = {
  name: string;
  values?: string[];
  inputType?: string | null;
};

export type RequiredSpecificsValidationResult = {
  itemSpecifics: ItemSpecificsRecord;
  addedItemSpecifics: ItemSpecificsRecord;
  missingItemSpecifics: string[];
  requiredItemSpecifics: RequiredItemSpecific[];
  decisions: RequiredSpecificDecision[];
};

function getRequiredAspects(aspects: EbayCategoryAspect[]) {
  return aspects.filter((aspect) => aspect.required);
}

export async function validateRequiredItemSpecifics(input: {
  product: Product;
  storeNumber: 1 | 2 | 3;
  supplierDefaultItemSpecifics?: unknown;
}): Promise<RequiredSpecificsValidationResult> {
  const specifics = sanitizeEbayItemSpecifics(input.product.itemSpecifics);

  const aspects = await getEbayCategoryAspects(
    input.product.category,
    input.storeNumber
  );
  const requiredAspects = getRequiredAspects(aspects);
  const requiredItemSpecifics = requiredAspects.map((aspect) => ({
    name: aspect.name,
    values: aspect.values.length > 0 ? aspect.values : undefined,
    inputType: aspect.inputType,
  }));
  const resolved = resolveRequiredItemSpecifics({
    title: input.product.title,
    categoryName: input.product.categoryName,
    description: input.product.description,
    brand: specifics.Brand,
    itemSpecifics: specifics,
    supplierDefaultItemSpecifics: input.supplierDefaultItemSpecifics,
    requiredItemSpecifics,
  });

  return {
    itemSpecifics: sanitizeEbayItemSpecifics(resolved.itemSpecifics),
    addedItemSpecifics: resolved.addedItemSpecifics,
    missingItemSpecifics: resolved.missingItemSpecifics,
    requiredItemSpecifics,
    decisions: resolved.decisions,
  };
}

export function buildMissingItemSpecificsResponse(message: string | null | undefined) {
  const missingItemSpecifics = parseMissingItemSpecificNames(message);
  return {
    missingItemSpecifics,
    requiredItemSpecifics: missingItemSpecifics.map((name) => ({ name })),
  };
}
