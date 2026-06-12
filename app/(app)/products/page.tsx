import { prisma } from "@/lib/prisma";
import ProductsPageClient from "@/components/ProductsPageClient";
import { ProductStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";

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
  const pageSize = parsePageSize(params.pageSize);
  const requestedPage = parsePositiveInteger(params.page, 1);
  const importedFilter =
    getSingleParam(params.imported) === "today" ? "today" : null;
  const productFilter = parseProductFilter(params.filter);
  const todayRange = importedFilter === "today" ? getTodayRange() : null;
  const where: Prisma.ProductWhereInput = {
    status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
    ...(todayRange
      ? {
          createdAt: {
            gte: todayRange.start,
            lt: todayRange.end,
          },
        }
      : {}),
    ...(productFilter === "needs-changing-price"
      ? {
          priceHistory: {
            some: {
              appliedAt: null,
            },
          },
        }
      : {}),
    ...(productFilter === "failed-on-hold"
      ? {
          OR: [
            { status: ProductStatus.ON_HOLD },
            { priceCheckError: { not: null } },
          ],
        }
      : {}),
  };

  const totalCount = await prisma.product.count({ where });
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
        take: 1,
        select: {
          id: true,
          title: true,
          buyPrice: true,
          sellPrice: true,
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

  const serializedProducts = products.map((product) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
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
      />
    </div>
  );
}
