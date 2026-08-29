import {
  getProductDisplayProfits,
  type ProductProfitCandidate,
} from "@/lib/product-profit";
import { getProductUploadedAt } from "@/lib/product-uploaded-at";

export const PRODUCT_SORT_FIELDS = ["price", "profit", "uploaded", "sold"] as const;
export const PRODUCT_SORT_ORDERS = ["asc", "desc"] as const;

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
export type ProductSortOrder = (typeof PRODUCT_SORT_ORDERS)[number];

type MoneyValue = number | string | { toString(): string } | null | undefined;

export type ProductSortCandidate = ProductProfitCandidate & {
  quantitySold?: number | null;
  uploadedAt?: string | Date | null;
  createdAt?: string | Date | null;
  status?: string | null;
  ebayItemId?: string | null;
  uploadLogs?: Array<{ createdAt: Date | string }> | null;
};

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
  if (sortBy === "price") {
    const values = getProductDisplaySellPrices(product);
    return values.length > 0 ? Math.min(...values) : null;
  }

  if (sortBy === "profit") {
    const values = getProductDisplayProfits(product);
    return values.length > 0 ? Math.min(...values) : null;
  }

  if (sortBy === "sold") {
    return product.quantitySold ?? 0;
  }

  if (sortBy === "uploaded") {
    if (product.uploadedAt) {
      const parsed = new Date(product.uploadedAt).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }

    const createdDate = product.createdAt ? new Date(product.createdAt) : new Date();
    const successfulUploadAt = product.uploadLogs?.[0]?.createdAt
      ? new Date(product.uploadLogs[0].createdAt)
      : null;

    const uploadedDate = getProductUploadedAt({
      successfulUploadAt,
      productCreatedAt: createdDate,
      ebayItemId: product.ebayItemId,
      status: product.status ?? "IMPORTED",
    });

    return uploadedDate ? uploadedDate.getTime() : null;
  }

  return null;
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
