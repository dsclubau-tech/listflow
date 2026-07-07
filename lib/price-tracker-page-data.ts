import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  actionCenterCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
  priceTrackerCacheTag,
  productsCacheTag,
} from "@/lib/cache-tags";
import { prisma } from "@/lib/prisma";

export async function getCachedPriceTrackerPageData(
  storeId: string,
  todayStartIso: string,
) {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(
    priceTrackerCacheTag(storeId),
    productsCacheTag(storeId),
    actionCenterCacheTag(storeId),
  );

  const todayUtc = new Date(todayStartIso);

  const [
    trackedCount,
    changedTodayProducts,
    failedProducts,
    lastRun,
    recentChanges,
    trackedProducts,
    pendingCount,
    lowStockProducts,
  ] = await Promise.all([
    prisma.product.count({
      where: {
        storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
      },
    }),
    prisma.priceHistory.findMany({
      where: {
        product: { storeId },
        createdAt: {
          gte: todayUtc,
        },
      },
      distinct: ["productId"],
      select: {
        productId: true,
      },
    }),
    prisma.product.findMany({
      where: {
        storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
        priceCheckError: { not: null },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        asin: true,
        ebayItemId: true,
        priceCheckError: true,
      },
    }),
    prisma.product.findFirst({
      where: {
        storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
        lastPriceCheck: { not: null },
      },
      orderBy: { lastPriceCheck: "desc" },
      select: { lastPriceCheck: true },
    }),
    prisma.priceHistory.findMany({
      where: { product: { storeId } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        product: {
          select: {
            id: true,
            title: true,
            asin: true,
            ebayItemId: true,
          },
        },
        variant: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
    prisma.product.findMany({
      where: {
        storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        asin: true,
        amazonPrice: true,
        amazonPriceTrackingMode: true,
        ebayItemId: true,
        variants: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            buyPrice: true,
            sellPrice: true,
          },
        },
      },
    }),
    prisma.priceHistory.count({
      where: { appliedAt: null, product: { storeId } },
    }),
    prisma.product.findMany({
      where: {
        storeId,
        status: "IMPORTED",
        asin: { not: null },
        amazonStockLeft: { not: null, lte: 3 },
      },
      orderBy: [{ amazonStockLeft: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        asin: true,
        ebayItemId: true,
        amazonStockLeft: true,
      },
    }),
  ]);

  return {
    summary: {
      trackedCount,
      changedToday: changedTodayProducts.length,
      failedChecks: failedProducts.length,
      lastRunAt: lastRun?.lastPriceCheck?.toISOString() ?? null,
    },
    history: recentChanges.map((item) => ({
      ...item,
      previousPrice: item.previousPrice.toString(),
      newPrice: item.newPrice.toString(),
      previousSellPrice: item.previousSellPrice.toString(),
      newSellPrice: item.newSellPrice.toString(),
      source: item.source,
      appliedAt: item.appliedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    trackedProducts: trackedProducts.map((product) => ({
      id: product.id,
      title: product.title,
      asin: product.asin,
      amazonPrice: product.amazonPrice?.toString() ?? null,
      amazonPriceTrackingMode: product.amazonPriceTrackingMode,
      ebayItemId: product.ebayItemId,
      buyPrice: product.variants[0]?.buyPrice.toString() ?? "0.00",
      sellPrice: product.variants[0]?.sellPrice.toString() ?? "0.00",
    })),
    pendingCount,
    failedProducts,
    lowStockProducts,
  };
}
