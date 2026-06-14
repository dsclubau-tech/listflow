import { prisma } from "@/lib/prisma";

export async function dismissObsoletePendingPriceChanges(reviewedAt = new Date()) {
  const pendingHistory = await prisma.priceHistory.findMany({
    where: { appliedAt: null },
    orderBy: [{ productId: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      productId: true,
      createdAt: true,
    },
  });

  const newestPendingByProduct = new Map<string, number>();
  const obsoleteHistoryIds: string[] = [];

  for (const item of pendingHistory) {
    const createdAtMs = item.createdAt.getTime();
    const newestCreatedAtMs = newestPendingByProduct.get(item.productId);

    if (newestCreatedAtMs === undefined) {
      newestPendingByProduct.set(item.productId, createdAtMs);
      continue;
    }

    if (createdAtMs < newestCreatedAtMs) {
      obsoleteHistoryIds.push(item.id);
    }
  }

  if (obsoleteHistoryIds.length === 0) {
    return 0;
  }

  const result = await prisma.priceHistory.updateMany({
    where: {
      id: { in: obsoleteHistoryIds },
      appliedAt: null,
    },
    data: {
      appliedAt: reviewedAt,
      ebayRevised: false,
      errorMessage: null,
    },
  });

  return result.count;
}
