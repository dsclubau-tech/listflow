import "server-only";

import type { Prisma } from "@/app/generated/prisma/client";
import { cacheLife, cacheTag } from "next/cache";
import {
  draftsCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
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

const productRowSelect = {
  id: true,
  title: true,
  price: true,
  quantity: true,
  images: true,
  status: true,
  ebayItemId: true,
  errorMessage: true,
  asin: true,
  amazonPrice: true,
  amazonPriceTrackingMode: true,
  amazonStockLeft: true,
  promotedAdPercent: true,
  promotedAdStatus: true,
  promotedAdCampaignId: true,
  promotedAdCampaignName: true,
  promotedAdRateStrategy: true,
  promotedAdSyncedAt: true,
  lastPriceCheck: true,
  priceCheckError: true,
  priceCheckFailureCode: true,
  internalNote: true,
  storeId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  store: {
    select: { id: true, name: true },
  },
  createdBy: {
    select: { id: true, name: true },
  },
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
} satisfies Prisma.ProductSelect;

type ProductRowPayload = Prisma.ProductGetPayload<{
  select: typeof productRowSelect;
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
  // Editor-only fields are loaded from the product detail endpoint on expansion.
  return products.map(({ uploadLogs, ...product }) =>
    ({
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
      store: product.store,
      createdBy: product.createdBy,
    }) as unknown as SerializedProductRow,
  );
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
    select: productRowSelect,
  });
  const order = new Map(ids.map((id, index) => [id, index]));

  return products.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
  );
}

export async function getCachedProductsPageData(
  storeId: string,
  storeName: string,
  query: NormalizedProductsQuery
): Promise<ProductsPageData> {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(
    productsCacheTag(storeId),
    draftsCacheTag(storeId)
  );

  const where = buildProductsWhere(storeId, query);
  const supplierOptions = [{ id: storeId, name: storeName }];

  if (hasProfitRangeFilter(query)) {
    // Profit is computed from variant pricing, so filter every matching
    // inventory row first, then paginate the filtered IDs.
    const filteredIds = await getProfitFilteredProductIds(where, query);
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

  const requestedPage = query.requestedPage;
  const [totalCount, requestedProducts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (requestedPage - 1) * query.pageSize,
      take: query.pageSize,
      select: productRowSelect,
    }),
  ]);
  const page = getPage(totalCount, query);
  const products =
    page === requestedPage
      ? requestedProducts
      : await prisma.product.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: productRowSelect,
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
