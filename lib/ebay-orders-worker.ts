import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrRefreshEntitlement } from "@/lib/aa-entitlement";
import { logger } from "@/lib/logger";
import { runScheduledEbayOrderSync } from "@/lib/ebay-orders-sync";
import { createOrdersWorkerLane, isOrdersStoreEntitled, type OrdersWorkerStore } from "@/lib/orders-worker-lane";
import type { WorkerContext } from "@/lib/job-coordination";

export function createEbayOrdersWorker(input: {
  getStores: () => Promise<OrdersWorkerStore[]>;
  getWorker: () => WorkerContext;
  paused: () => boolean;
}) {
  return createOrdersWorkerLane({
    getStores: input.getStores,
    paused: input.paused,
    isEligible: store => isOrdersStoreEntitled(store, {
      getEntitlement: getOrRefreshEntitlement,
      getRankedStores: ownerUserId => prisma.store.findMany({
        where: { ownerUserId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true },
      }),
    }),
    sync: storeId => runScheduledEbayOrderSync(storeId, input.getWorker()),
    reportError: (_error, storeId) => logger.warn("worker/orders", "Order scheduler will retry on the next tick", {
      storeId, category: "orders-scheduler",
    }),
  });
}
