import {
  getProductDisplayProfits,
  type ProductProfitCandidate,
} from "@/lib/product-profit";

export const PRODUCT_SORT_FIELDS = ["price", "profit"] as const;
export const PRODUCT_SORT_ORDERS = ["asc", "desc"] as const;

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
export type ProductSortOrder = (typeof PRODUCT_SORT_ORDERS)[number];

type MoneyValue = number | string | { toString(): string } | null | undefined;

export type ProductSortCandidate = ProductProfitCandidate;

function parseMoney(value: MoneyValue) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProductDisplaySellPrices(product: ProductSortCandidate) {
  const variantPrices = (product.variants ?? [])
    .map((variant) => parseMoney(variant.sellPrice))
    .filter((value): value is number => value !== null);

  if (variantPrices.length > 0) {
    return variantPrices;
  }

  const fallbackPrice = parseMoney(product.price);
  return fallbackPrice === null ? [] : [fallbackPrice];
}

function getProductSortValue(
  product: ProductSortCandidate,
  sortBy: ProductSortField,
) {
  const values =
    sortBy === "price"
      ? getProductDisplaySellPrices(product)
      : getProductDisplayProfits(product);

  return values.length > 0 ? Math.min(...values) : null;
}

export function sortProductsByDisplayValue<T extends ProductSortCandidate>(
  products: readonly T[],
  sortBy: ProductSortField,
  sortOrder: ProductSortOrder,
) {
  const direction = sortOrder === "asc" ? 1 : -1;

  return products
    .map((product, index) => ({
      product,
      index,
      value: getProductSortValue(product, sortBy),
    }))
    .sort((left, right) => {
      if (left.value === null) {
        return right.value === null ? left.index - right.index : 1;
      }

      if (right.value === null) {
        return -1;
      }

      const valueOrder = (left.value - right.value) * direction;
      return valueOrder || left.index - right.index;
    })
    .map(({ product }) => product);
}
