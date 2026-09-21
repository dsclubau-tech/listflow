import type { Prisma } from "@/app/generated/prisma/client";

export function buildProductSearchWhere(query: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { fullTitle: { contains: query, mode: "insensitive" } },
      { id: { contains: query, mode: "insensitive" } },
      { asin: { contains: query, mode: "insensitive" } },
      { ebayItemId: { contains: query, mode: "insensitive" } },
      { internalNote: { contains: query, mode: "insensitive" } },
      { itemSpecifics: { path: ["Brand"], string_contains: query, mode: "insensitive" } },
      { itemSpecifics: { path: ["brand"], string_contains: query, mode: "insensitive" } },
      { variants: { some: { id: { contains: query, mode: "insensitive" } } } },
      { variants: { some: { sku: { contains: query, mode: "insensitive" } } } },
      {
        variants: {
          some: {
            itemSpecifics: { path: ["Brand"], string_contains: query, mode: "insensitive" },
          },
        },
      },
      {
        variants: {
          some: {
            itemSpecifics: { path: ["brand"], string_contains: query, mode: "insensitive" },
          },
        },
      },
    ],
  };
}

type SearchRankProduct = {
  id: string;
  title: string;
  fullTitle?: string | null;
  asin?: string | null;
  ebayItemId?: string | null;
  updatedAt: Date;
  variants?: Array<{ id: string; sku?: string | null }>;
};

export function rankProductSearchResults<T extends SearchRankProduct>(
  products: T[],
  rawQuery: string,
) {
  const query = rawQuery.trim().toLocaleLowerCase();
  const score = (product: T) => {
    const identifiers = [
      product.id,
      product.asin,
      product.ebayItemId,
      ...(product.variants ?? []).flatMap((variant) => [variant.id, variant.sku]),
    ].filter((value): value is string => Boolean(value));
    if (identifiers.some((value) => value.toLocaleLowerCase() === query)) return 0;
    if (product.title.toLocaleLowerCase() === query) return 1;
    if (product.title.toLocaleLowerCase().startsWith(query)) return 2;
    if (product.fullTitle?.toLocaleLowerCase().startsWith(query)) return 3;
    if (identifiers.some((value) => value.toLocaleLowerCase().includes(query))) return 4;
    if (product.title.toLocaleLowerCase().includes(query)) return 5;
    return 6;
  };

  return products.slice().sort((left, right) => {
    const scoreDifference = score(left) - score(right);
    if (scoreDifference !== 0) return scoreDifference;
    const updatedDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
    return updatedDifference !== 0 ? updatedDifference : left.id.localeCompare(right.id);
  });
}
