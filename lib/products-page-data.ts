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
import { productMatchesDisplayProfitRange } from "@/lib/product-profit";
import {
  sortProductsByDisplayValue,
  type ProductSortField,
  type ProductSortOrder,
} from "@/lib/product-sort";
import { prisma } from "@/lib/prisma";
import type { ProductSelectionSummary } from "@/types/product-selection";
import type { SerializedProductRow } from "@/types/product-row";
import { getProductUploadedAt } from "@/lib/product-uploaded-at";

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
  sortBy: ProductSortField | null;
  sortOrder: ProductSortOrder;
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
  quantitySold: true,
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
  holdReason: true,
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

const productSortCandidateSelect = {
  id: true,
  price: true,
  amazonPrice: true,
  quantitySold: true,
  createdAt: true,
  status: true,
  ebayItemId: true,
  uploadLogs: {
    where: { status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      createdAt: true,
    },
  },
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

const productSelectionSelect = {
  id: true,
  title: true,
  status: true,
  asin: true,
  storeId: true,
  price: true,
  amazonPrice: true,
  variants: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      buyPrice: true,
      sellPrice: true,
      feesPercent: true,
      feesFixed: true,
    },
  },
  _count: {
    select: {
      variants: true,
      priceHistory: { where: { appliedAt: null } },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductSelectionPayload = Prisma.ProductGetPayload<{
  select: typeof productSelectionSelect;
}>;

function serializeProductSelection(
  products: ProductSelectionPayload[],
): ProductSelectionSummary[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    status: product.status,
    asin: product.asin,
    storeId: product.storeId,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    variants: product.variants.map((variant) => ({
      ...variant,
      buyPrice: variant.buyPrice.toString(),
      sellPrice: variant.sellPrice.toString(),
    })),
    _count: { variants: product._count.variants },
    hasPendingPriceChange: product._count.priceHistory > 0,
  }));
}

function serializeProducts(products: ProductRowPayload[]): SerializedProductRow[] {
  // Editor-only fields are loaded from the product detail endpoint on expansion.
  return products.map(({ uploadLogs, ...product }) => {
    const uploadedAt = getProductUploadedAt({
      successfulUploadAt: uploadLogs[0]?.createdAt,
      productCreatedAt: product.createdAt,
      ebayItemId: product.ebayItemId,
      status: product.status,
    });

    return ({
      ...product,
      price: product.price.toString(),
      amazonPrice: product.amazonPrice?.toString() ?? null,
      lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
      promotedAdSyncedAt: product.promotedAdSyncedAt?.toISOString() ?? null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      uploadedAt: uploadedAt?.toISOString() ?? null,
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
    }) as unknown as SerializedProductRow;
  });
}

function getPage(totalCount: number, query: NormalizedProductsQuery) {
  const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize));
  return Math.min(query.requestedPage, totalPages);
}

async function getComputedProductOrderIds(
  where: Prisma.ProductWhereInput,
  query: NormalizedProductsQuery
) {
  const candidates = await prisma.product.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: productSortCandidateSelect,
  });
  const filteredCandidates = hasProfitRangeFilter(query)
    ? candidates.filter((product) =>
        productMatchesDisplayProfitRange(
          product,
          query.profitMin,
          query.profitMax
        )
      )
    : candidates;

  return (query.sortBy
    ? sortProductsByDisplayValue(
        filteredCandidates,
        query.sortBy,
        query.sortOrder
      )
    : filteredCandidates
  ).map((product) => product.id);
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

async function getProductSelectionRowsByIds(storeId: string, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: { storeId, id: { in: ids } },
    select: productSelectionSelect,
  });
  const order = new Map(ids.map((id, index) => [id, index]));

  return products.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
}

export async function getCachedProductsSelectionData(
  storeId: string,
  query: NormalizedProductsQuery,
) {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(productsCacheTag(storeId), draftsCacheTag(storeId));

  const where = buildProductsWhere(storeId, query);

  if (hasProfitRangeFilter(query) || query.sortBy) {
    const orderedIds = await getComputedProductOrderIds(where, query);
    const products = await getProductSelectionRowsByIds(storeId, orderedIds);

    return {
      products: serializeProductSelection(products),
      totalCount: products.length,
    };
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: productSelectionSelect,
  });

  return {
    products: serializeProductSelection(products),
    totalCount: products.length,
  };
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

  if (hasProfitRangeFilter(query) || query.sortBy) {
    // Visible prices and profits can come from variant ranges. Compute the
    // complete filtered order first so sorting remains correct across pages.
    const orderedIds = await getComputedProductOrderIds(where, query);
    const totalCount = orderedIds.length;
    const page = getPage(totalCount, query);
    const pageIds = orderedIds.slice(
      (page - 1) * query.pageSize,
      page * query.pageSize
    );
    const products = await getProductRowsByIds(storeId, pageIds);

    return {
      products: serializeProducts(products),
      totalCount,
      page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
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
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
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
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: productRowSelect,
        });

  return {
    products: serializeProducts(products),
    totalCount,
    page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    importedFilter: query.importedFilter,
    productFilter: query.productFilter,
    hasAdvancedFilters: query.hasAdvancedFilters,
    supplierOptions,
  };
}
