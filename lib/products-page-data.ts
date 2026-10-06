import "server-only";
import { resolveCurrentHoldReason } from "@/lib/current-hold-reason";
import { getProductShippingPresentation } from "./amazon-shipping-display";
import { loadMissingCommittedShippingObservations } from "./product-shipping-observations";
import { getAmazonPriceSelection } from "@/lib/amazon-price-selection";

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
import { rankProductSearchResults } from "@/lib/product-search";
import { getFastProductSearchPage } from "@/lib/fast-product-search";

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
  ebayViewCount: true,
  images: true,
  status: true,
  ebayItemId: true,
  errorMessage: true,
  asin: true,
  amazonPrice: true,
  amazonPriceTrackingMode: true,
  amazonStockLeft: true,
  amazonAvailability: true,
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
  holdOrigin: true,
  holdGeneration: true,
  holdSavedQuantity: true,
  holdLastObservationId: true,
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
      quantity: true,
      status: true,
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
  amazonPriceObservations: {
    orderBy: { observedAt: "desc" },
    take: 5,
    select: {
      id: true,
      stockLeft: true,
      requestedAsin: true,
      selectedAsin: true,
      identityOutcome: true,
      buyBoxOutcome: true,
      acceptedPriceSource: true,
      postcodeVerified: true,
      isSuccessful: true,
      eligibleOffer: true,
      priceMode: true,
      price: true,
      regularPrice: true,
      dealPrice: true,
      observedAt: true, shippingEvidence: true, verifiedPostcode: true,
    },
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
  title: true,
  fullTitle: true,
  asin: true,
  ebayItemId: true,
  price: true,
  amazonPrice: true,
  quantitySold: true,
  ebayViewCount: true,
  createdAt: true,
  updatedAt: true,
  status: true,
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
      id: true,
      sku: true,
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

async function serializeProducts(products: ProductRowPayload[], minimumProductQuantity: number, shippingSettings: { maxShippingDays: number; scrapePostcode: string } | null): Promise<SerializedProductRow[]> {
  const committed = await loadMissingCommittedShippingObservations(products);
  const serializeObservation = (observation: ProductRowPayload["amazonPriceObservations"][number]) => ({
    ...observation,
    price: observation.price?.toString() ?? null,
    regularPrice: observation.regularPrice?.toString() ?? null,
    dealPrice: observation.dealPrice?.toString() ?? null,
    observedAt: observation.observedAt.toISOString(),
  });
  // Editor-only fields are loaded from the product detail endpoint on expansion.
  return products.map(({ uploadLogs, ...product }) => {
    const uploadedAt = getProductUploadedAt({
      successfulUploadAt: uploadLogs[0]?.createdAt,
      productCreatedAt: product.createdAt,
      ebayItemId: product.ebayItemId,
      status: product.status,
    });

    const missingCommitted = product.holdLastObservationId ? committed.get(product.holdLastObservationId) : undefined;
    const observations = missingCommitted ? [...product.amazonPriceObservations, missingCommitted] : product.amazonPriceObservations;
    const { currentObservation, amazonShippingStatus, amazonShippingDisplay } = getProductShippingPresentation(product, observations, shippingSettings);
    const holdExplanation = resolveCurrentHoldReason({
      amazonShippingStatus,
      status: product.status,
      holdOrigin: product.holdOrigin,
      holdReason: product.holdReason,
      priceCheckError: product.priceCheckError,
      priceCheckFailureCode: product.priceCheckFailureCode,
      lastPriceCheck: product.lastPriceCheck,
      amazonStockLeft: product.amazonStockLeft,
      amazonAvailability: product.amazonAvailability,
      savedQuantity: product.quantity,
      minimumProductQuantity,
      hasPendingReview: product.priceHistory.length > 0,
      asin: product.asin,
      latestObservation: currentObservation,
    });

    return ({
      ...product,
      ...holdExplanation,
      amazonPriceSelection: getAmazonPriceSelection(product, currentObservation),
      amazonShippingStatus,
      amazonShippingDisplay,
      amazonPriceObservations: product.amazonPriceObservations.map(serializeObservation),
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
      amazonVerification: (currentObservation ?? product.amazonPriceObservations[0])
        ? serializeObservation(currentObservation ?? product.amazonPriceObservations[0])
        : null,
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

  const orderedCandidates = query.sortBy
    ? sortProductsByDisplayValue(
        filteredCandidates,
        query.sortBy,
        query.sortOrder
      )
    : query.searchQuery
      ? rankProductSearchResults(filteredCandidates, query.searchQuery)
      : filteredCandidates;

  return orderedCandidates.map((product) => product.id);
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

  const settings = await prisma.supplierSettings.findUnique({
    where: { storeId_supplierName: { storeId, supplierName: "Amazon AU" } },
    select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true },
  });
  const where = buildProductsWhere(storeId, query, settings?.minProductQuantity ?? 2);

  if (hasProfitRangeFilter(query) || query.sortBy || query.searchQuery) {
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

  const settings = await prisma.supplierSettings.findUnique({
    where: { storeId_supplierName: { storeId, supplierName: "Amazon AU" } },
    select: { minProductQuantity: true, maxShippingDays: true, scrapePostcode: true },
  });
  const where = buildProductsWhere(storeId, query, settings?.minProductQuantity ?? 2);
  const supplierOptions = [{ id: storeId, name: storeName }];

  if (query.searchQuery) {
    const minimum = settings?.minProductQuantity ?? 2;
    const requested = await getFastProductSearchPage({
      storeId, query, minimumProductQuantity: minimum,
      take: query.pageSize, skip: (query.requestedPage - 1) * query.pageSize,
    });
    const page = getPage(requested.totalCount, query);
    const ids = page === query.requestedPage ? requested.ids :
      (await getFastProductSearchPage({ storeId, query, minimumProductQuantity: minimum,
        take: query.pageSize, skip: (page - 1) * query.pageSize })).ids;
    const products = await getProductRowsByIds(storeId, ids);
    return {
      products: await serializeProducts(products, settings?.minProductQuantity ?? 2, settings),
      totalCount: requested.totalCount,
      page, pageSize: query.pageSize, sortBy: query.sortBy,
      sortOrder: query.sortOrder, importedFilter: query.importedFilter,
      productFilter: query.productFilter, hasAdvancedFilters: query.hasAdvancedFilters,
      supplierOptions,
    };
  }

  if (hasProfitRangeFilter(query) || query.sortBy || query.searchQuery) {
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
      products: await serializeProducts(products, settings?.minProductQuantity ?? 2, settings),
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
    products: await serializeProducts(products, settings?.minProductQuantity ?? 2, settings),
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
