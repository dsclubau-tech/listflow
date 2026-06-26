import { prisma } from "@/lib/prisma";
import ProductsPageClient from "@/components/ProductsPageClient";
import { ProductStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { PRODUCT_ADVANCED_FILTER_IDS } from "@/lib/product-filter-definitions";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 100;
const PRODUCT_FILTERS = [
  "all",
  "needs-changing-price",
  "failed-on-hold",
] as const;

type ProductFilter = (typeof PRODUCT_FILTERS)[number];

type SearchParamValue = string | string[] | undefined;

function getSingleParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: SearchParamValue, fallback: number) {
  const parsed = Number.parseInt(getSingleParam(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value: SearchParamValue) {
  const parsed = parsePositiveInteger(value, DEFAULT_PAGE_SIZE);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

function parseProductFilter(value: SearchParamValue): ProductFilter {
  const filter = getSingleParam(value);

  return PRODUCT_FILTERS.includes(filter as ProductFilter)
    ? (filter as ProductFilter)
    : "all";
}

function getTextParam(params: Record<string, SearchParamValue>, key: string) {
  return getSingleParam(params[key])?.trim() ?? "";
}

function getSelectParam(
  params: Record<string, SearchParamValue>,
  key: string,
  allowedValues: string[]
) {
  const value = getTextParam(params, key);

  return allowedValues.includes(value) ? value : "";
}

function getNumberParam(params: Record<string, SearchParamValue>, key: string) {
  const value = getTextParam(params, key);
  const parsed = Number(value);

  return value && Number.isFinite(parsed) ? parsed : null;
}

function getRangeFilter(
  params: Record<string, SearchParamValue>,
  minKey: string,
  maxKey: string
) {
  const min = getNumberParam(params, minKey);
  const max = getNumberParam(params, maxKey);
  const range: { gte?: number; lte?: number } = {};

  if (min !== null) {
    range.gte = min;
  }

  if (max !== null) {
    range.lte = max;
  }

  return Object.keys(range).length > 0 ? range : null;
}

function hasActiveAdvancedFilters(params: Record<string, SearchParamValue>) {
  return PRODUCT_ADVANCED_FILTER_IDS.some((filterId) => {
    if (
      filterId === "sellPrice" ||
      filterId === "buyPrice" ||
      filterId === "profit" ||
      filterId === "quantity" ||
      filterId === "fees"
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, SearchParamValue>>;
}) {
  const params = (await searchParams) ?? {};
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const pageSize = parsePageSize(params.pageSize);
  const requestedPage = parsePositiveInteger(params.page, 1);
  const importedFilter =
    getSingleParam(params.imported) === "today" ? "today" : null;
  const productFilter = parseProductFilter(params.filter);
  const todayRange = importedFilter === "today" ? getTodayRange() : null;
  const whereClauses: Prisma.ProductWhereInput[] = [
    { status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] } },
    { storeId: storeSession.storeId },
  ];

  if (todayRange) {
    whereClauses.push({
      createdAt: {
        gte: todayRange.start,
        lt: todayRange.end,
      },
    });
  }

  if (productFilter === "needs-changing-price") {
    whereClauses.push({
      priceHistory: {
        some: {
          appliedAt: null,
        },
      },
    });
  }

  if (productFilter === "failed-on-hold") {
    whereClauses.push({
      OR: [
        { status: ProductStatus.ON_HOLD },
        { priceCheckError: { not: null } },
      ],
    });
  }

  const supplier = getTextParam(params, "supplier");
  if (supplier && supplier === storeSession.storeId) {
    whereClauses.push({ storeId: supplier });
  }

  const title = getTextParam(params, "title");
  if (title) {
    whereClauses.push({ title: { contains: title, mode: "insensitive" } });
  }

  const brand = getTextParam(params, "brand");
  if (brand) {
    whereClauses.push({
      OR: [
        { itemSpecifics: { path: ["Brand"], string_contains: brand } },
        { itemSpecifics: { path: ["brand"], string_contains: brand } },
        { variants: { some: { itemSpecifics: { path: ["Brand"], string_contains: brand } } } },
        { variants: { some: { itemSpecifics: { path: ["brand"], string_contains: brand } } } },
      ],
    });
  }

  const note = getTextParam(params, "note");
  if (note) {
    whereClauses.push({
      internalNote: { contains: note, mode: "insensitive" },
    });
  }

  const searchQuery = getTextParam(params, "q");
  if (searchQuery) {
    whereClauses.push({
      OR: [
        { title: { contains: searchQuery, mode: "insensitive" } },
        { id: { contains: searchQuery, mode: "insensitive" } },
        { asin: { contains: searchQuery, mode: "insensitive" } },
        { ebayItemId: { contains: searchQuery, mode: "insensitive" } },
        { internalNote: { contains: searchQuery, mode: "insensitive" } },
        { itemSpecifics: { path: ["Brand"], string_contains: searchQuery } },
        { itemSpecifics: { path: ["brand"], string_contains: searchQuery } },
        { variants: { some: { id: { contains: searchQuery, mode: "insensitive" } } } },
        { variants: { some: { sku: { contains: searchQuery, mode: "insensitive" } } } },
        { variants: { some: { itemSpecifics: { path: ["Brand"], string_contains: searchQuery } } } },
        { variants: { some: { itemSpecifics: { path: ["brand"], string_contains: searchQuery } } } },
      ],
    });
  }

  const buyItemId = getTextParam(params, "buyItemId");
  if (buyItemId) {
    whereClauses.push({
      asin: { contains: buyItemId, mode: "insensitive" },
    });
  }

  const productId = getTextParam(params, "productId");
  if (productId) {
    whereClauses.push({
      OR: [
        { id: { contains: productId, mode: "insensitive" } },
        { asin: { contains: productId, mode: "insensitive" } },
        { ebayItemId: { contains: productId, mode: "insensitive" } },
        { variants: { some: { id: { contains: productId, mode: "insensitive" } } } },
        { variants: { some: { sku: { contains: productId, mode: "insensitive" } } } },
      ],
    });
  }

  const sellPriceRange = getRangeFilter(params, "sellPriceMin", "sellPriceMax");
  if (sellPriceRange) {
    whereClauses.push({
      OR: [
        { price: sellPriceRange },
        { variants: { some: { sellPrice: sellPriceRange } } },
      ],
    });
  }

  const buyPriceRange = getRangeFilter(params, "buyPriceMin", "buyPriceMax");
  if (buyPriceRange) {
    whereClauses.push({
      OR: [
        { amazonPrice: buyPriceRange },
        { variants: { some: { buyPrice: buyPriceRange } } },
      ],
    });
  }

  const profitRange = getRangeFilter(params, "profitMin", "profitMax");
  if (profitRange) {
    whereClauses.push({
      variants: {
        some: {
          OR: [{ profitFixed: profitRange }, { profitPercent: profitRange }],
        },
      },
    });
  }

  const quantityRange = getRangeFilter(params, "quantityMin", "quantityMax");
  if (quantityRange) {
    whereClauses.push({
      OR: [
        { quantity: quantityRange },
        { variants: { some: { quantity: quantityRange } } },
      ],
    });
  }

  const inventoryStatus = getSelectParam(params, "inventoryStatus", [
    "imported",
    "on-hold",
    "check-failed",
  ]);
  if (inventoryStatus === "imported") {
    whereClauses.push({ status: ProductStatus.IMPORTED });
  } else if (inventoryStatus === "on-hold") {
    whereClauses.push({ status: ProductStatus.ON_HOLD });
  } else if (inventoryStatus === "check-failed") {
    whereClauses.push({ priceCheckError: { not: null } });
  }

  const stockMonitoring = getSelectParam(params, "stockMonitoring", [
    "low-stock",
    "has-stock-data",
    "no-stock-data",
  ]);
  if (stockMonitoring === "low-stock") {
    whereClauses.push({
      AND: [
        { amazonStockLeft: { not: null } },
        { amazonStockLeft: { lte: 3 } },
      ],
    });
  } else if (stockMonitoring === "has-stock-data") {
    whereClauses.push({ amazonStockLeft: { not: null } });
  } else if (stockMonitoring === "no-stock-data") {
    whereClauses.push({ amazonStockLeft: null });
  }

  const priceMonitoring = getSelectParam(params, "priceMonitoring", [
    "needs-changing-price",
    "check-failed",
    "not-checked",
    "checked",
    "tracked",
  ]);
  if (priceMonitoring === "needs-changing-price") {
    whereClauses.push({ priceHistory: { some: { appliedAt: null } } });
  } else if (priceMonitoring === "check-failed") {
    whereClauses.push({ priceCheckError: { not: null } });
  } else if (priceMonitoring === "not-checked") {
    whereClauses.push({ lastPriceCheck: null });
  } else if (priceMonitoring === "checked") {
    whereClauses.push({ lastPriceCheck: { not: null } });
  } else if (priceMonitoring === "tracked") {
    whereClauses.push({ asin: { not: null } });
  }

  const autoOrder = getSelectParam(params, "autoOrder", [
    "configured",
    "not-configured",
  ]);
  if (autoOrder === "configured") {
    whereClauses.push({ variants: { some: { automation: { not: null } } } });
  } else if (autoOrder === "not-configured") {
    whereClauses.push({ variants: { none: { automation: { not: null } } } });
  }

  const veroViolation = getSelectParam(params, "veroViolation", ["potential"]);
  if (veroViolation === "potential") {
    whereClauses.push({
      OR: [
        { errorMessage: { contains: "vero", mode: "insensitive" } },
        { priceCheckError: { contains: "vero", mode: "insensitive" } },
      ],
    });
  }

  const feesRange = getRangeFilter(params, "feesMin", "feesMax");
  if (feesRange) {
    whereClauses.push({
      variants: {
        some: {
          OR: [{ feesPercent: feesRange }, { feesFixed: feesRange }],
        },
      },
    });
  }

  const where: Prisma.ProductWhereInput = { AND: whereClauses };

  const [totalCount, storeOptions] = await Promise.all([
    prisma.product.count({ where }),
    prisma.store.findMany({
      where: { id: storeSession.storeId },
      select: { id: true, name: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
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
    },
  });

  const serializedProducts = products.map(({ uploadLogs, ...product }) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
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

  return (
    <div className="p-8">
      <ProductsPageClient
        products={serializedProducts as never}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        importedFilter={importedFilter}
        productFilter={productFilter}
        hasAdvancedFilters={hasActiveAdvancedFilters(params)}
        supplierOptions={storeOptions}
      />
    </div>
  );
}
