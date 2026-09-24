export type EbayCategorySuggestion = { categoryId: string; categoryName: string };

const APPLIANCE_TYPES: Array<{ title: RegExp; category: RegExp }> = [
  { title: /\bmulti[-\s]?cookers?\b/i, category: /\bmulti[-\s]?cookers?\b/i },
  { title: /\bslow[-\s]?cookers?\b/i, category: /\bslow cookers?\b/i },
  { title: /\bpressure[-\s]?cookers?\b/i, category: /\bpressure cookers?\b/i },
  { title: /\brice cookers?\b/i, category: /\brice cookers?\b/i },
  { title: /\b(?:sandwich|panini) (?:makers?|press(?:es)?)\b/i, category: /\bgrills|sandwich makers?\b/i },
  { title: /\bwaffle makers?\b/i, category: /\bwaffle makers?\b/i },
  { title: /\b(?:air|deep) fryers?\b/i, category: /\bfryers?\b/i },
  { title: /\belectric skillets?\b/i, category: /\belectric skillets?\b/i },
  { title: /\bfood processors?\b/i, category: /\bfood processors?\b/i },
];

export function isBookCategory(category: string) {
  return /(?:^|>)\s*(?:books?\b|magazines?\b|comics?\b|textbooks?\b)/i.test(category);
}

export function getSmallKitchenApplianceType(title: string, sourceCategory?: string | null) {
  // Only classify complete appliances. A cookbook, lid, or replacement part
  // mentioning a cooker must keep its own category search.
  if (isBookCategory(sourceCategory ?? "") ||
    /\b(?:books?|cookbooks?|recipes?|manuals?|parts?|replacement|accessories|accessory|covers?|cases?|lids?|gaskets?|seals?|liners?|baskets?)\b/i.test(title)) {
    return null;
  }
  const productTitle = title.split(/\b(?:compatible with|for|fits)\b/i)[0];
  return APPLIANCE_TYPES.find((type) => type.title.test(productTitle)) ?? null;
}

export function selectSmallKitchenApplianceCategories(
  title: string,
  categories: readonly EbayCategorySuggestion[],
  sourceCategory?: string | null,
) {
  const type = getSmallKitchenApplianceType(title, sourceCategory);
  if (!type) return [];
  const candidates = categories.filter((category) =>
    /\bSmall Kitchen Appliances\b/i.test(category.categoryName) &&
    !/\bparts?|accessories|covers?\b/i.test(category.categoryName),
  );
  const matches = candidates.filter((category) => type.category.test(category.categoryName.split(">").at(-1) ?? ""));
  if (matches.length > 0) return matches;
  // A multicooker is not necessarily a slow cooker or pressure cooker. Use the
  // current taxonomy's general appliance leaf instead of inventing a subtype.
  return candidates.filter((category) => /\bOther Small (?:Kitchen )?Appliances$/i.test(category.categoryName));
}

export function filterEbayCategorySuggestions(
  suggestions: readonly EbayCategorySuggestion[],
  sourceCategory?: string | null,
) {
  if (!sourceCategory?.trim() || isBookCategory(sourceCategory)) return [...suggestions];
  return suggestions.filter((suggestion) => !isBookCategory(suggestion.categoryName));
}

export function hasMismatchedApplianceCategory(title: string, categoryName: string | null) {
  return Boolean(
    getSmallKitchenApplianceType(title) && categoryName?.trim() &&
    (isBookCategory(categoryName) || /\bClothing|Handbags\b/i.test(categoryName) ||
      (/\bSmall Kitchen Appliances\b/i.test(categoryName) && /\bparts?|accessories\b/i.test(categoryName))),
  );
}
