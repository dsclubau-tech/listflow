import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function dismissObsoletePendingPriceChanges(
  storeId?: string,
  reviewedAt = new Date()
) {
  const where: Prisma.PriceHistoryWhereInput = {
    appliedAt: null,
    ...(storeId ? { product: { storeId } } : {}),
  };
  const pendingHistory = await prisma.priceHistory.findMany({
    where,
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
      ...(storeId ? { product: { storeId } } : {}),
    },
    data: {
      appliedAt: reviewedAt,
      ebayRevised: false,
      errorMessage: null,
    },
  });

  return result.count;
}
