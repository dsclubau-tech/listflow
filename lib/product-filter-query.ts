import {
  ProductStatus,
  PromotedAdRateStrategy,
  PromotedAdStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { PRODUCT_ADVANCED_FILTER_IDS } from "@/lib/product-filter-definitions";
import {
  PRODUCT_SORT_FIELDS,
  PRODUCT_SORT_ORDERS,
  type ProductSortField,
  type ProductSortOrder,
} from "@/lib/product-sort";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PRODUCTS_PAGE_SIZE = 100;
const PRODUCT_FILTERS = [
  "all",
  "needs-changing-price",
  "failed-on-hold",
] as const;

export type ProductFilter = (typeof PRODUCT_FILTERS)[number];
export type SearchParamValue = string | string[] | undefined;
export type ProductsSearchParams = Record<string, SearchParamValue>;

export interface NormalizedProductsQuery {
  pageSize: number;
  requestedPage: number;
  sortBy: ProductSortField | null;
  sortOrder: ProductSortOrder;
  importedFilter: "today" | null;
  productFilter: ProductFilter;
  hasAdvancedFilters: boolean;
  todayStartIso: string | null;
  todayEndIso: string | null;
  supplier: string;
  title: string;
  brand: string;
  note: string;
  searchQuery: string;
  buyItemId: string;
  productId: string;
  sellPriceMin: number | null;
  sellPriceMax: number | null;
  buyPriceMin: number | null;
  buyPriceMax: number | null;
  profitMin: number | null;
  profitMax: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  feesMin: number | null;
  feesMax: number | null;
  promotedAdPercentMin: number | null;
  promotedAdPercentMax: number | null;
  adFeeStatus: string;
  inventoryStatus: string;
  stockMonitoring: string;
  priceMonitoring: string;
  autoOrder: string;
  veroViolation: string;
}

function getSingleParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: SearchParamValue, fallback: number) {
  const parsed = Number.parseInt(getSingleParam(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value: SearchParamValue) {
  const parsed = parsePositiveInteger(value, DEFAULT_PRODUCTS_PAGE_SIZE);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PRODUCTS_PAGE_SIZE;
}

function parseProductFilter(value: SearchParamValue): ProductFilter {
  const filter = getSingleParam(value);

  return PRODUCT_FILTERS.includes(filter as ProductFilter)
    ? (filter as ProductFilter)
    : "all";
}

function parseProductSortField(value: SearchParamValue) {
  const sortBy = getSingleParam(value);

  return PRODUCT_SORT_FIELDS.includes(sortBy as ProductSortField)
    ? (sortBy as ProductSortField)
    : null;
}

function parseProductSortOrder(value: SearchParamValue): ProductSortOrder {
  const sortOrder = getSingleParam(value);

  return PRODUCT_SORT_ORDERS.includes(sortOrder as ProductSortOrder)
    ? (sortOrder as ProductSortOrder)
    : "asc";
}

function getTextParam(params: ProductsSearchParams, key: string) {
  return getSingleParam(params[key])?.trim() ?? "";
}

function getSelectParam(
  params: ProductsSearchParams,
  key: string,
  allowedValues: string[]
) {
  const value = getTextParam(params, key);

  return allowedValues.includes(value) ? value : "";
}

function getNumberParam(params: ProductsSearchParams, key: string) {
  const value = getTextParam(params, key);
  const parsed = Number(value);

  return value && Number.isFinite(parsed) ? parsed : null;
}

function hasActiveAdvancedFilters(params: ProductsSearchParams) {
  return PRODUCT_ADVANCED_FILTER_IDS.some((filterId) => {
    if (
      filterId === "sellPrice" ||
      filterId === "buyPrice" ||
      filterId === "profit" ||
      filterId === "quantity" ||
      filterId === "fees" ||
      filterId === "promotedAdPercent"
    ) {
      return (
        params[`${filterId}Min`] !== undefined ||
        params[`${filterId}Max`] !== undefined
      );
    }

    return params[filterId] !== undefined;
  });
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

export function normalizeProductsQuery(
  params: ProductsSearchParams
): NormalizedProductsQuery {
  const importedFilter =
    getSingleParam(params.imported) === "today" ? "today" : null;
  const todayRange = importedFilter === "today" ? getTodayRange() : null;

  return {
    pageSize: parsePageSize(params.pageSize),
    requestedPage: parsePositiveInteger(params.page, 1),
    sortBy: parseProductSortField(params.sortBy),
    sortOrder: parseProductSortOrder(params.sortOrder),
    importedFilter,
    productFilter: parseProductFilter(params.filter),
    hasAdvancedFilters: hasActiveAdvancedFilters(params),
    todayStartIso: todayRange?.start.toISOString() ?? null,
    todayEndIso: todayRange?.end.toISOString() ?? null,
    supplier: getTextParam(params, "supplier"),
    title: getTextParam(params, "title"),
    brand: getTextParam(params, "brand"),
    note: getTextParam(params, "note"),
    searchQuery: getTextParam(params, "q"),
    buyItemId: getTextParam(params, "buyItemId"),
    productId: getTextParam(params, "productId"),
    sellPriceMin: getNumberParam(params, "sellPriceMin"),
    sellPriceMax: getNumberParam(params, "sellPriceMax"),
    buyPriceMin: getNumberParam(params, "buyPriceMin"),
    buyPriceMax: getNumberParam(params, "buyPriceMax"),
    profitMin: getNumberParam(params, "profitMin"),
    profitMax: getNumberParam(params, "profitMax"),
    quantityMin: getNumberParam(params, "quantityMin"),
    quantityMax: getNumberParam(params, "quantityMax"),
    feesMin: getNumberParam(params, "feesMin"),
    feesMax: getNumberParam(params, "feesMax"),
    promotedAdPercentMin: getNumberParam(params, "promotedAdPercentMin"),
    promotedAdPercentMax: getNumberParam(params, "promotedAdPercentMax"),
    adFeeStatus: getSelectParam(params, "adFeeStatus", [
      "promoted",
      "not-promoted",
      "not-synced",
    ]),
    inventoryStatus: getSelectParam(params, "inventoryStatus", [
      "imported",
      "on-hold",
      "check-failed",
    ]),
    stockMonitoring: getSelectParam(params, "stockMonitoring", [
      "low-stock",
      "has-stock-data",
      "no-stock-data",
    ]),
    priceMonitoring: getSelectParam(params, "priceMonitoring", [
      "needs-changing-price",
      "check-failed",
      "not-checked",
      "checked",
      "tracked",
    ]),
    autoOrder: getSelectParam(params, "autoOrder", [
      "configured",
      "not-configured",
    ]),
    veroViolation: getSelectParam(params, "veroViolation", ["potential"]),
  };
}

export function getRangeFilter(min: number | null, max: number | null) {
  const range: { gte?: number; lte?: number } = {};

  if (min !== null) {
    range.gte = min;
  }

  if (max !== null) {
    range.lte = max;
  }

  return Object.keys(range).length > 0 ? range : null;
}

export function hasProfitRangeFilter(query: NormalizedProductsQuery) {
  return query.profitMin !== null || query.profitMax !== null;
}

export function buildProductsWhere(
  storeId: string,
  query: NormalizedProductsQuery
): Prisma.ProductWhereInput {
  const whereClauses: Prisma.ProductWhereInput[] = [
    { status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] } },
    { storeId },
  ];

  if (query.importedFilter === "today" && query.todayStartIso && query.todayEndIso) {
    whereClauses.push({
      createdAt: {
        gte: new Date(query.todayStartIso),
        lt: new Date(query.todayEndIso),
      },
    });
  }

  if (query.productFilter === "needs-changing-price") {
    whereClauses.push({ priceHistory: { some: { appliedAt: null } } });
  }

  if (query.productFilter === "failed-on-hold") {
    whereClauses.push({
      OR: [
        { status: ProductStatus.ON_HOLD },
        { priceCheckError: { not: null } },
      ],
    });
  }

  if (query.supplier && query.supplier === storeId) {
    whereClauses.push({ storeId: query.supplier });
  }

  if (query.title) {
    whereClauses.push({ title: { contains: query.title, mode: "insensitive" } });
  }

  if (query.brand) {
    whereClauses.push({
      OR: [
        { itemSpecifics: { path: ["Brand"], string_contains: query.brand } },
        { itemSpecifics: { path: ["brand"], string_contains: query.brand } },
        {
          variants: {
            some: {
              itemSpecifics: { path: ["Brand"], string_contains: query.brand },
            },
          },
        },
        {
          variants: {
            some: {
              itemSpecifics: { path: ["brand"], string_contains: query.brand },
            },
          },
        },
      ],
    });
  }

  if (query.note) {
    whereClauses.push({
      internalNote: { contains: query.note, mode: "insensitive" },
    });
  }

  if (query.searchQuery) {
    whereClauses.push({
      OR: [
        { title: { contains: query.searchQuery, mode: "insensitive" } },
        { id: { contains: query.searchQuery, mode: "insensitive" } },
        { asin: { contains: query.searchQuery, mode: "insensitive" } },
        { ebayItemId: { contains: query.searchQuery, mode: "insensitive" } },
        { internalNote: { contains: query.searchQuery, mode: "insensitive" } },
        { itemSpecifics: { path: ["Brand"], string_contains: query.searchQuery } },
        { itemSpecifics: { path: ["brand"], string_contains: query.searchQuery } },
        {
          variants: {
            some: { id: { contains: query.searchQuery, mode: "insensitive" } },
          },
        },
        {
          variants: {
            some: { sku: { contains: query.searchQuery, mode: "insensitive" } },
          },
        },
        {
          variants: {
            some: {
              itemSpecifics: {
                path: ["Brand"],
                string_contains: query.searchQuery,
              },
            },
          },
        },
        {
          variants: {
            some: {
              itemSpecifics: {
                path: ["brand"],
                string_contains: query.searchQuery,
              },
            },
          },
        },
      ],
    });
  }

  if (query.buyItemId) {
    whereClauses.push({
      asin: { contains: query.buyItemId, mode: "insensitive" },
    });
  }

  if (query.productId) {
    whereClauses.push({
      OR: [
        { id: { contains: query.productId, mode: "insensitive" } },
        { asin: { contains: query.productId, mode: "insensitive" } },
        { ebayItemId: { contains: query.productId, mode: "insensitive" } },
        {
          variants: {
            some: { id: { contains: query.productId, mode: "insensitive" } },
          },
        },
        {
          variants: {
            some: { sku: { contains: query.productId, mode: "insensitive" } },
          },
        },
      ],
    });
  }

  const sellPriceRange = getRangeFilter(query.sellPriceMin, query.sellPriceMax);
  if (sellPriceRange) {
    whereClauses.push({
      OR: [
        { price: sellPriceRange },
        { variants: { some: { sellPrice: sellPriceRange } } },
      ],
    });
  }

  const buyPriceRange = getRangeFilter(query.buyPriceMin, query.buyPriceMax);
  if (buyPriceRange) {
    whereClauses.push({
      OR: [
        { amazonPrice: buyPriceRange },
        { variants: { some: { buyPrice: buyPriceRange } } },
      ],
    });
  }

  const quantityRange = getRangeFilter(query.quantityMin, query.quantityMax);
  if (quantityRange) {
    whereClauses.push({
      OR: [
        { quantity: quantityRange },
        { variants: { some: { quantity: quantityRange } } },
      ],
    });
  }

  if (query.inventoryStatus === "imported") {
    whereClauses.push({ status: ProductStatus.IMPORTED });
  } else if (query.inventoryStatus === "on-hold") {
    whereClauses.push({ status: ProductStatus.ON_HOLD });
  } else if (query.inventoryStatus === "check-failed") {
    whereClauses.push({ priceCheckError: { not: null } });
  }

  if (query.stockMonitoring === "low-stock") {
    whereClauses.push({
      AND: [
        { amazonStockLeft: { not: null } },
        { amazonStockLeft: { lte: 3 } },
      ],
    });
  } else if (query.stockMonitoring === "has-stock-data") {
    whereClauses.push({ amazonStockLeft: { not: null } });
  } else if (query.stockMonitoring === "no-stock-data") {
    whereClauses.push({ amazonStockLeft: null });
  }

  if (query.priceMonitoring === "needs-changing-price") {
    whereClauses.push({ priceHistory: { some: { appliedAt: null } } });
  } else if (query.priceMonitoring === "check-failed") {
    whereClauses.push({ priceCheckError: { not: null } });
  } else if (query.priceMonitoring === "not-checked") {
    whereClauses.push({ lastPriceCheck: null });
  } else if (query.priceMonitoring === "checked") {
    whereClauses.push({ lastPriceCheck: { not: null } });
  } else if (query.priceMonitoring === "tracked") {
    whereClauses.push({ asin: { not: null } });
  }

  if (query.autoOrder === "configured") {
    whereClauses.push({ variants: { some: { automation: { not: null } } } });
  } else if (query.autoOrder === "not-configured") {
    whereClauses.push({ variants: { none: { automation: { not: null } } } });
  }

  if (query.veroViolation === "potential") {
    whereClauses.push({
      OR: [
        { errorMessage: { contains: "vero", mode: "insensitive" } },
        { priceCheckError: { contains: "vero", mode: "insensitive" } },
      ],
    });
  }

  const feesRange = getRangeFilter(query.feesMin, query.feesMax);
  if (feesRange) {
    whereClauses.push({
      variants: {
        some: {
          OR: [{ feesPercent: feesRange }, { feesFixed: feesRange }],
        },
      },
    });
  }

  const promotedAdPercentRange = getRangeFilter(
    query.promotedAdPercentMin,
    query.promotedAdPercentMax
  );
  if (promotedAdPercentRange) {
    whereClauses.push({
      promotedAdStatus: PromotedAdStatus.PROMOTED,
      promotedAdRateStrategy: PromotedAdRateStrategy.FIXED,
      promotedAdPercent: promotedAdPercentRange,
    });
  }

  if (query.adFeeStatus === "promoted") {
    whereClauses.push({ promotedAdStatus: PromotedAdStatus.PROMOTED });
  } else if (query.adFeeStatus === "not-promoted") {
    whereClauses.push({ promotedAdStatus: PromotedAdStatus.NOT_PROMOTED });
  } else if (query.adFeeStatus === "not-synced") {
    whereClauses.push({
      OR: [
        { promotedAdStatus: PromotedAdStatus.UNKNOWN },
        { promotedAdSyncedAt: null },
      ],
    });
  }

  return { AND: whereClauses };
}
