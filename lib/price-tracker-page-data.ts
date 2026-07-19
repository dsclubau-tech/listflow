import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  actionCenterCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
  priceTrackerCacheTag,
  productsCacheTag,
} from "@/lib/cache-tags";
import { calculatePendingReviewMetrics } from "@/lib/action-center-metrics";
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
        status: { in: ["IMPORTED", "ON_HOLD"] },
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
        status: { in: ["IMPORTED", "ON_HOLD"] },
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
        status: { in: ["IMPORTED", "ON_HOLD"] },
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
            promotedAdStatus: true,
            promotedAdPercent: true,
          },
        },
        variant: {
          select: {
            id: true,
            title: true,
            feesPercent: true,
            feesFixed: true,
          },
        },
      },
    }),
    prisma.product.findMany({
      where: {
        storeId,
        status: { in: ["IMPORTED", "ON_HOLD"] },
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
    history: recentChanges.map((item) => {
      const metrics = calculatePendingReviewMetrics({
        previousBuyPrice: Number(item.previousPrice),
        newBuyPrice: Number(item.newPrice),
        newSellPrice: Number(item.newSellPrice),
        feesPercent: item.variant?.feesPercent ?? null,
        feesFixed: item.variant?.feesFixed ?? null,
        promotedAdStatus: item.product.promotedAdStatus,
        promotedAdPercent: item.product.promotedAdPercent,
      });

      return {
        ...item,
        previousPrice: item.previousPrice.toString(),
        newPrice: item.newPrice.toString(),
        previousSellPrice: item.previousSellPrice.toString(),
        newSellPrice: item.newSellPrice.toString(),
        changeAmount: metrics.changeAmount.toFixed(2),
        profit: metrics.profit === null ? null : metrics.profit.toFixed(2),
        source: item.source,
        appliedAt: item.appliedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      };
    }),
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
