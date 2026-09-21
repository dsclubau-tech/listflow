import { PRODUCT_ADVANCED_FILTERS } from "@/lib/product-filter-definitions";

export type ProductFilterDraft = Partial<Record<string, string>>;

export function getProductRangeFilterValidationError(draft: ProductFilterDraft) {
  for (const filter of PRODUCT_ADVANCED_FILTERS) {
    if (filter.control !== "range") continue;
    const minKey = `${filter.id}Min`;
    const maxKey = `${filter.id}Max`;
    if (!(minKey in draft) && !(maxKey in draft)) continue;
    const minText = draft[minKey]?.trim() ?? "";
    const maxText = draft[maxKey]?.trim() ?? "";
    const min = minText === "" ? null : Number(minText);
    const max = maxText === "" ? null : Number(maxText);

    if ((minText && !Number.isFinite(min)) || (maxText && !Number.isFinite(max))) {
      return `${filter.label} must contain valid numbers.`;
    }
    if ((min !== null && min < 0) || (max !== null && max < 0)) {
      return `${filter.label} cannot be negative.`;
    }
    if (min !== null && max !== null && min > max) {
      return `${filter.label} minimum cannot be greater than maximum.`;
    }
  }
  return null;
}
