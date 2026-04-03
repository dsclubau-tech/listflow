import { prisma } from "@/lib/prisma";
import PriceTrackerClient from "@/components/PriceTrackerClient";

export default async function PriceTrackerPage() {
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const [trackedCount, changedTodayProducts, failedChecks, lastRun, recentChanges] =
    await Promise.all([
      prisma.product.count({
        where: {
          status: "IMPORTED",
          asin: { not: null },
          variants: { some: {} },
        },
      }),
      prisma.priceHistory.findMany({
        where: {
          createdAt: {
            gte: todayUtc,
          },
        },
        distinct: ["productId"],
        select: {
          productId: true,
        },
      }),
      prisma.product.count({
        where: {
          status: "IMPORTED",
          asin: { not: null },
          variants: { some: {} },
          priceCheckError: { not: null },
        },
      }),
      prisma.product.findFirst({
        where: {
          status: "IMPORTED",
          asin: { not: null },
          variants: { some: {} },
          lastPriceCheck: { not: null },
        },
        orderBy: { lastPriceCheck: "desc" },
        select: { lastPriceCheck: true },
      }),
      prisma.priceHistory.findMany({
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
    ]);

  const summary = {
    trackedCount,
    changedToday: changedTodayProducts.length,
    failedChecks,
    lastRunAt: lastRun?.lastPriceCheck?.toISOString() ?? null,
  };

  const history = recentChanges.map((item) => ({
    ...item,
    previousPrice: item.previousPrice.toString(),
    newPrice: item.newPrice.toString(),
    previousSellPrice: item.previousSellPrice.toString(),
    newSellPrice: item.newSellPrice.toString(),
    createdAt: item.createdAt.toISOString(),
  }));

  return (
    <div className="p-8">
      <PriceTrackerClient initialSummary={summary} initialHistory={history} />
    </div>
  );
}
