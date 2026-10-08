import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getStoreCredentials, getStoreNumber } from "@/lib/ebay";
import { fetchEbayOrdersPage, EbayOrdersRequestError } from "@/lib/ebay-orders-client";
import {
  EBAY_ORDERS_SYNC_INTERVAL_MS, EBAY_ORDERS_SYNC_TASK_KEY, importEbayOrders,
  type ImportedOrderLine,
} from "@/lib/ebay-orders-import";
import { loadOrderMatchProducts, orderAccountKey } from "@/lib/orders-data";
import { matchOrderProduct } from "@/lib/orders";
import type { WorkerContext } from "@/lib/job-coordination";
import { completeWorkerSchedule, retryWorkerSchedule, tryClaimWorkerSchedule, withWorkerScheduleClaim } from "@/lib/worker-schedule";

const LEASE_TTL_MS = 90_000;

export async function runScheduledEbayOrderSync(storeId: string, worker: WorkerContext) {
  let storeNumber: 1 | 2 | 3;
  try { storeNumber = await getStoreNumber(storeId); } catch { return { skipped: true }; }
  const credentials = getStoreCredentials(storeNumber);
  if (!credentials.refreshToken || !credentials.appId || !credentials.certId) return { skipped: true };
  const accountKey = orderAccountKey(storeNumber);
  // Activation is persisted once, as soon as a configured account is eligible.
  const state = await prisma.ebayOrderSyncState.upsert({
    where: { storeId_accountKey: { storeId, accountKey } },
    create: { storeId, accountKey }, update: {},
  });
  const claim = await tryClaimWorkerSchedule({ storeId, taskKey: EBAY_ORDERS_SYNC_TASK_KEY, worker, leaseTtlMs: LEASE_TTL_MS });
  if (!claim) return { skipped: true };
  const claimToken = randomUUID();
  try {
    await prisma.ebayOrderSyncState.update({ where: { id: state.id }, data: { claimToken } });
    const result = await withWorkerScheduleClaim(claim, LEASE_TTL_MS, async () => {
      // Read the watermark only after obtaining the schedule lease.
      const current = await prisma.ebayOrderSyncState.findUniqueOrThrow({ where: { id: state.id } });
      const through = new Date();
      async function saveLines(lines: ImportedOrderLine[]) {
        if (lines.length === 0) return 0;
        const candidates = await loadOrderMatchProducts(storeId, lines.flatMap(line => line.ebayItemId ? [line.ebayItemId] : []));
        return prisma.$transaction(async tx => {
          // Fence old runs after lease recovery. This row lock covers the whole page write.
          const held = await tx.ebayOrderSyncState.updateMany({
            where: { id: state.id, claimToken }, data: { claimToken },
          });
          if (held.count !== 1) throw new Error("Order sync lost its claim");
          let unmatched = 0;
          for (const line of lines) {
            const match = matchOrderProduct(storeId, line, candidates);
            if (!match) unmatched++;
            const key = { storeId, accountKey, ebayOrderId: line.ebayOrderId, lineItemId: line.lineItemId };
            const existing = await tx.ebayOrderLine.findUnique({
              where: { storeId_accountKey_ebayOrderId_lineItemId: key }, select: { orderModifiedAt: true },
            });
            if (existing && existing.orderModifiedAt > line.orderModifiedAt) continue;
            const imported = { ...line, importedAt: new Date(), productId: match?.product.id ?? null, variantId: match?.variant?.id ?? null };
            // No manual fields in update: status/date survive every replay.
            await tx.ebayOrderLine.upsert({
              where: { storeId_accountKey_ebayOrderId_lineItemId: key },
              create: { ...key, ...imported }, update: imported,
            });
          }
          return unmatched;
        }, { timeout: 30_000 });
      }
      const result = await importEbayOrders({
        activatedAt: current.activatedAt, lastSyncedTo: current.lastSyncedTo, through,
      }, {
        fetchPage: (filter, offset) => fetchEbayOrdersPage({ storeId, storeNumber, filter, offset }),
        saveLines,
        // Commit only after both streams and all pages succeed.
        complete: async () => {
          await rematchRetainedLines(storeId, accountKey, state.id, claimToken);
          const completed = await prisma.ebayOrderSyncState.updateMany({
            where: { id: state.id, claimToken },
            data: { lastSyncedTo: through, lastSuccessAt: new Date(), lastError: null },
          });
          if (completed.count !== 1) throw new Error("Order sync lost its claim");
        },
      });
      return result;
    });
    await completeWorkerSchedule(claim, EBAY_ORDERS_SYNC_INTERVAL_MS);
    logger.info("ebay/orders-sync", "Automatic order sync completed", { storeId, ...result });
    return { skipped: false, ...result };
  } catch (error) {
    const message = error instanceof EbayOrdersRequestError ? error.message : "Automatic order syncing temporarily failed. It will retry.";
    await prisma.ebayOrderSyncState.updateMany({
      where: { id: state.id, claimToken }, data: { lastError: message },
    }).catch(() => undefined);
    await retryWorkerSchedule(claim, error instanceof EbayOrdersRequestError ? error.retryAfterMs : EBAY_ORDERS_SYNC_INTERVAL_MS, message);
    logger.warn("ebay/orders-sync", "Automatic order sync deferred", { storeId, category: error instanceof EbayOrdersRequestError ? "ebay-request" : "processing" });
    return { skipped: false, failed: true };
  }
}

async function rematchRetainedLines(storeId: string, accountKey: string, stateId: string, claimToken: string) {
  let cursor: string | undefined;
  while (true) {
    const lines = await prisma.ebayOrderLine.findMany({
      where: { storeId, accountKey }, orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, ebayItemId: true, ebayVariationId: true, sku: true, productId: true, variantId: true },
    });
    if (lines.length === 0) return;
    const candidates = await loadOrderMatchProducts(storeId, lines.flatMap(line => line.ebayItemId ? [line.ebayItemId] : []));
    await prisma.$transaction(async tx => {
      const held = await tx.ebayOrderSyncState.updateMany({ where: { id: stateId, claimToken }, data: { claimToken } });
      if (held.count !== 1) throw new Error("Order sync lost its claim");
      for (const line of lines) {
        const match = matchOrderProduct(storeId, line, candidates);
        const productId = match?.product.id ?? null, variantId = match?.variant?.id ?? null;
        if (productId !== line.productId || variantId !== line.variantId) {
          await tx.ebayOrderLine.updateMany({ where: { id: line.id, storeId, accountKey }, data: { productId, variantId } });
        }
      }
    }, { timeout: 30_000 });
    cursor = lines[lines.length - 1].id;
  }
}
