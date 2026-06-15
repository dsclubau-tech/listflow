import { prisma } from "@/lib/prisma";
import PriceTrackerClient from "@/components/PriceTrackerClient";
import { dismissObsoletePendingPriceChanges } from "@/lib/price-history-cleanup";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";

export default async function PriceTrackerPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  await dismissObsoletePendingPriceChanges(storeSession.storeId);

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

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
        storeId: storeSession.storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
      },
    }),
    prisma.priceHistory.findMany({
      where: {
        product: { storeId: storeSession.storeId },
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
        storeId: storeSession.storeId,
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
        storeId: storeSession.storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
        lastPriceCheck: { not: null },
      },
      orderBy: { lastPriceCheck: "desc" },
      select: { lastPriceCheck: true },
    }),
    prisma.priceHistory.findMany({
      where: { product: { storeId: storeSession.storeId } },
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
        storeId: storeSession.storeId,
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
      where: { appliedAt: null, product: { storeId: storeSession.storeId } },
    }),
    prisma.product.findMany({
      where: {
        storeId: storeSession.storeId,
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

  const summary = {
    trackedCount,
    changedToday: changedTodayProducts.length,
    failedChecks: failedProducts.length,
    lastRunAt: lastRun?.lastPriceCheck?.toISOString() ?? null,
  };

  const history = recentChanges.map((item) => ({
    ...item,
    previousPrice: item.previousPrice.toString(),
    newPrice: item.newPrice.toString(),
    previousSellPrice: item.previousSellPrice.toString(),
    newSellPrice: item.newSellPrice.toString(),
    source: item.source,
    appliedAt: item.appliedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  }));

  const initialTrackedProducts = trackedProducts.map((product) => ({
    id: product.id,
    title: product.title,
    asin: product.asin,
    amazonPrice: product.amazonPrice?.toString() ?? null,
    ebayItemId: product.ebayItemId,
    buyPrice: product.variants[0]?.buyPrice.toString() ?? "0.00",
    sellPrice: product.variants[0]?.sellPrice.toString() ?? "0.00",
  }));

  return (
    <div className="p-8">
      <PriceTrackerClient
        initialSummary={summary}
        initialHistory={history}
        initialTrackedProducts={initialTrackedProducts}
        pendingCount={pendingCount}
        failedProducts={failedProducts}
        lowStockProducts={lowStockProducts}
      />
    </div>
  );
}
