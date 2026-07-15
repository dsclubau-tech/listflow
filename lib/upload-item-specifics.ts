import {
  sanitizeEbayItemSpecifics,
  type ItemSpecificsRecord,
} from "@/lib/item-specifics";
import {
  resolveRequiredItemSpecifics,
  type RequiredSpecificDecision,
} from "@/lib/required-specific-resolver";

export type UploadRequiredItemSpecific = {
  name: string;
  values?: string[];
  inputType?: string | null;
};

export type UploadMissingSpecificsRetryResult = {
  itemSpecifics: ItemSpecificsRecord;
  addedItemSpecifics: ItemSpecificsRecord;
  missingItemSpecifics: string[];
  requiredItemSpecifics: UploadRequiredItemSpecific[];
  decisions: RequiredSpecificDecision[];
  shouldRetry: boolean;
};

function normalizeSpecificName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function shouldBlockUploadForRequiredSpecificsPreflight(_input: {
  missingItemSpecifics: string[];
}): boolean {
  return false;
}

export function getRequiredItemSpecificsForMissingNames(
  missingItemSpecifics: string[],
  knownRequiredItemSpecifics: UploadRequiredItemSpecific[] = [],
) {
  const knownByName = new Map(
    knownRequiredItemSpecifics.map((specific) => [
      normalizeSpecificName(specific.name),
      specific,
    ]),
  );

  return missingItemSpecifics
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => knownByName.get(normalizeSpecificName(name)) ?? { name });
}

export function resolveMissingItemSpecificsForUploadRetry(input: {
  title?: string | null;
  categoryName?: string | null;
  description?: string | null;
  brand?: string | null;
  itemSpecifics?: unknown;
  supplierDefaultItemSpecifics?: unknown;
  missingItemSpecifics: string[];
  requiredItemSpecifics?: UploadRequiredItemSpecific[];
}): UploadMissingSpecificsRetryResult {
  const requiredItemSpecifics = getRequiredItemSpecificsForMissingNames(
    input.missingItemSpecifics,
    input.requiredItemSpecifics,
  );

  if (requiredItemSpecifics.length === 0) {
    const itemSpecifics = sanitizeEbayItemSpecifics(input.itemSpecifics);

    return {
      itemSpecifics,
      addedItemSpecifics: {},
      missingItemSpecifics: [],
      requiredItemSpecifics,
      decisions: [],
      shouldRetry: false,
    };
  }

  const resolved = resolveRequiredItemSpecifics({
    title: input.title,
    categoryName: input.categoryName,
    description: input.description,
    brand: input.brand,
    itemSpecifics: input.itemSpecifics,
    supplierDefaultItemSpecifics: input.supplierDefaultItemSpecifics,
    requiredItemSpecifics,
  });

  return {
    itemSpecifics: sanitizeEbayItemSpecifics(resolved.itemSpecifics),
    addedItemSpecifics: resolved.addedItemSpecifics,
    missingItemSpecifics: resolved.missingItemSpecifics,
    requiredItemSpecifics,
    decisions: resolved.decisions,
    shouldRetry: Object.keys(resolved.addedItemSpecifics).length > 0,
  };
}
