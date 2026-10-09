import "server-only";
import { prisma } from "@/lib/prisma";
import { orderGroupKey } from "@/lib/order-notes";
import { matchOrderProduct, toOrderRow } from "@/lib/orders";
import { getStoreNumber, ebayConfig } from "@/lib/ebay";
import type { OrdersPageData } from "@/types/order";

export const orderMatchProductSelect = {
  id: true, storeId: true, ebayItemId: true, asin: true, amazonPrice: true, images: true,
  promotedAdStatus: true, promotedAdPercent: true, promotedAdRateStrategy: true,
  variants: { select: { id: true, sku: true, buyPrice: true, feesPercent: true, feesFixed: true, images: true } },
} as const;

export function orderAccountKey(storeNumber: 1 | 2 | 3) {
  return ebayConfig.environment + ":store:" + storeNumber;
}

export async function loadOrderMatchProducts(storeId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return prisma.product.findMany({
    where: { storeId, ebayItemId: { in: Array.from(new Set(itemIds)) } },
    select: orderMatchProductSelect,
  });
}

export function normalizeOrdersPagination(page: unknown, pageSize: unknown) {
  const p = Number(page), size = Number(pageSize);
  return {
    page: Number.isSafeInteger(p) && p > 0 ? Math.min(p, 1_000_000) : 1,
    pageSize: [10, 20, 50, 100, 200].includes(size) ? size : 50,
  };
}

export async function getOrdersPageData(storeId: string, requestedPage = 1, pageSize = 50): Promise<OrdersPageData> {
  const { page: wantedPage, pageSize: size } = normalizeOrdersPagination(requestedPage, pageSize);
  let accountKey: string | null = null;
  try { accountKey = orderAccountKey(await getStoreNumber(storeId)); } catch { /* Show retained orders even if disconnected. */ }
  const where = { storeId, ...(accountKey ? { accountKey } : {}) };
  const totalCount = await prisma.ebayOrderLine.count({ where });
  const page = Math.min(wantedPage, Math.max(1, Math.ceil(totalCount / size)));
  const [lines, state] = await Promise.all([
    prisma.ebayOrderLine.findMany({
      where, orderBy: [{ orderCreatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * size, take: size,
    }),
    accountKey ? prisma.ebayOrderSyncState.findUnique({
      where: { storeId_accountKey: { storeId, accountKey } },
    }) : Promise.resolve(null),
  ]);
  const orders = Array.from(new Map(lines.map(line => [orderGroupKey(line), {
    accountKey: line.accountKey, ebayOrderId: line.ebayOrderId,
  }])).values());
  const [candidates, notes] = await Promise.all([
    loadOrderMatchProducts(storeId, lines.flatMap(line => line.ebayItemId ? [line.ebayItemId] : [])),
    orders.length ? prisma.ebayOrderNote.findMany({
      where: { storeId, OR: orders },
      select: { accountKey: true, ebayOrderId: true, internalNote: true },
    }) : Promise.resolve([]),
  ]);
  const noteByOrder = new Map(notes.map(note => [orderGroupKey({ storeId, ...note }), note.internalNote]));
  return {
    storeId, rows: lines.map(line => toOrderRow(line, matchOrderProduct(storeId, line, candidates), noteByOrder.get(orderGroupKey(line)) ?? null)),
    totalCount, page, pageSize: size,
    sync: {
      activatedAt: state?.activatedAt.toISOString() ?? null,
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      error: state?.lastError ?? null,
    },
  };
}
