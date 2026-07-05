import "server-only";

import type { Prisma } from "@/app/generated/prisma/client";
import { cacheLife, cacheTag } from "next/cache";
import {
  draftsCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
  priceTrackerCacheTag,
  productsCacheTag,
} from "@/lib/cache-tags";
import {
  buildProductsWhere,
  hasProfitRangeFilter,
  normalizeProductsQuery,
  type NormalizedProductsQuery,
  type ProductFilter,
  type ProductsSearchParams,
  type SearchParamValue,
} from "@/lib/product-filter-query";
import { getProductIdsMatchingDisplayProfitRange } from "@/lib/product-profit";
import { prisma } from "@/lib/prisma";
import type { SerializedProductRow } from "@/types/product-row";

export { normalizeProductsQuery };
export type {
  NormalizedProductsQuery,
  ProductFilter,
  ProductsSearchParams,
  SearchParamValue,
};

export interface ProductsPageData {
  products: SerializedProductRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  importedFilter: "today" | null;
  productFilter: ProductFilter;
  hasAdvancedFilters: boolean;
  supplierOptions: Array<{ id: string; name: string }>;
}

const productRowInclude = {
  store: true,
  createdBy: true,
  variants: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      buyPrice: true,
      feesPercent: true,
      feesFixed: true,
      profitPercent: true,
      profitFixed: true,
      promotedAdPercent: true,
      sellPrice: true,
    },
  },
  uploadLogs: {
    where: { status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      createdAt: true,
    },
  },
  priceHistory: {
    where: { appliedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  _count: {
    select: {
      variants: true,
    },
  },
} satisfies Prisma.ProductInclude;

type ProductRowPayload = Prisma.ProductGetPayload<{
  include: typeof productRowInclude;
}>;

const profitCandidateSelect = {
  id: true,
  price: true,
  amazonPrice: true,
  variants: {
    orderBy: { createdAt: "asc" },
    select: {
      buyPrice: true,
      sellPrice: true,
      feesPercent: true,
      feesFixed: true,
    },
  },
} satisfies Prisma.ProductSelect;

function serializeProducts(products: ProductRowPayload[]): SerializedProductRow[] {
  return products.map(({ uploadLogs, ...product }) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
    promotedAdSyncedAt: product.promotedAdSyncedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    uploadedAt: uploadLogs[0]?.createdAt.toISOString() ?? null,
    variants: product.variants.map((variant) => ({
      ...variant,
      buyPrice: variant.buyPrice.toString(),
      sellPrice: variant.sellPrice.toString(),
    })),
    priceHistory: product.priceHistory.map((entry) => ({
      ...entry,
      previousPrice: entry.previousPrice.toString(),
      newPrice: entry.newPrice.toString(),
      previousSellPrice: entry.previousSellPrice.toString(),
      newSellPrice: entry.newSellPrice.toString(),
      appliedAt: entry.appliedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
    store: {
      ...product.store,
      createdAt: product.store.createdAt.toISOString(),
      updatedAt: product.store.updatedAt.toISOString(),
    },
    createdBy: {
      ...product.createdBy,
      createdAt: product.createdBy.createdAt.toISOString(),
      updatedAt: product.createdBy.updatedAt.toISOString(),
    },
  }));
}

async function getSupplierOptions(storeId: string) {
  return prisma.store.findMany({
    where: { id: storeId },
    select: { id: true, name: true },
  });
}

function getPage(totalCount: number, query: NormalizedProductsQuery) {
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  return Math.min(query.requestedPage, totalPages);
}

async function getProfitFilteredProductIds(
  where: Prisma.ProductWhereInput,
  query: NormalizedProductsQuery
) {
  const candidates = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: profitCandidateSelect,
  });

  return getProductIdsMatchingDisplayProfitRange(
    candidates,
    query.profitMin,
    query.profitMax
  );
}

async function getProductRowsByIds(storeId: string, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: { storeId, id: { in: ids } },
    include: productRowInclude,
  });
  const order = new Map(ids.map((id, index) => [id, index]));

  return products.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
  );
}

export async function getCachedProductsPageData(
  storeId: string,
  query: NormalizedProductsQuery
): Promise<ProductsPageData> {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(
    productsCacheTag(storeId),
    draftsCacheTag(storeId),
    priceTrackerCacheTag(storeId)
  );

  const where = buildProductsWhere(storeId, query);
  const supplierOptionsPromise = getSupplierOptions(storeId);

  if (hasProfitRangeFilter(query)) {
    // Profit is computed from variant pricing, so filter every matching
    // inventory row first, then paginate the filtered IDs.
    const [filteredIds, supplierOptions] = await Promise.all([
      getProfitFilteredProductIds(where, query),
      supplierOptionsPromise,
    ]);
    const totalCount = filteredIds.length;
    const page = getPage(totalCount, query);
    const pageIds = filteredIds.slice(
      (page - 1) * query.pageSize,
      page * query.pageSize
    );
    const products = await getProductRowsByIds(storeId, pageIds);

    return {
      products: serializeProducts(products),
      totalCount,
      page,
      pageSize: query.pageSize,
      importedFilter: query.importedFilter,
      productFilter: query.productFilter,
      hasAdvancedFilters: query.hasAdvancedFilters,
      supplierOptions,
    };
  }

  const [totalCount, supplierOptions] = await Promise.all([
    prisma.product.count({ where }),
    supplierOptionsPromise,
  ]);
  const page = getPage(totalCount, query);
  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    include: productRowInclude,
  });

  return {
    products: serializeProducts(products),
    totalCount,
    page,
    pageSize: query.pageSize,
    importedFilter: query.importedFilter,
    productFilter: query.productFilter,
    hasAdvancedFilters: query.hasAdvancedFilters,
    supplierOptions,
  };
}
