export const EBAY_ORDERS_SYNC_TASK_KEY = "ebay-orders-sync";
export const EBAY_ORDERS_SYNC_INTERVAL_MS = 5 * 60_000;
export const EBAY_ORDERS_OVERLAP_MS = 2 * 60_000;
export const EBAY_ORDERS_PAGE_SIZE = 100;

type EbayAmount = { value?: string; currency?: string };
export type EbayOrderPayload = {
  orderId?: string; creationDate?: string; lastModifiedDate?: string;
  lineItems?: Array<{
    lineItemId?: string; legacyItemId?: string; legacyVariationId?: string;
    sku?: string; title?: string; quantity?: number;
    lineItemCost?: EbayAmount; discountedLineItemCost?: EbayAmount;
  }>;
};
export type EbayOrdersPage = { orders?: EbayOrderPayload[]; total?: number; next?: string; offset?: number };
export type ImportedOrderLine = {
  ebayOrderId: string; lineItemId: string; ebayItemId: string | null;
  ebayVariationId: string | null; sku: string | null; title: string;
  quantity: number; sellTotal: string; currency: string;
  orderCreatedAt: Date; orderModifiedAt: Date;
};

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error("eBay order is missing " + field);
  return value.trim();
}
function timestamp(value: unknown, field: string) {
  const result = new Date(requiredText(value, field));
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid eBay " + field);
  return result;
}
function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeEbayOrder(order: EbayOrderPayload, activatedAt: Date): ImportedOrderLine[] {
  const orderCreatedAt = timestamp(order.creationDate, "creationDate");
  if (orderCreatedAt < activatedAt) return [];
  const ebayOrderId = requiredText(order.orderId, "orderId");
  const orderModifiedAt = timestamp(order.lastModifiedDate ?? order.creationDate, "lastModifiedDate");
  if (!Array.isArray(order.lineItems) || order.lineItems.length === 0) throw new Error("eBay order has no line items");
  return order.lineItems.map(line => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity! < 1) throw new Error("Invalid eBay line quantity");
    // eBay documents both costs as totals for the purchased quantity, not unit prices.
    const amount = line.discountedLineItemCost ?? line.lineItemCost;
    const value = requiredText(amount?.value, "line item sale amount");
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) >= 10_000_000_000) {
      throw new Error("Invalid eBay line sale amount");
    }
    const currency = requiredText(amount?.currency, "currency");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid eBay currency");
    return {
      ebayOrderId, lineItemId: requiredText(line.lineItemId, "lineItemId"),
      ebayItemId: optionalText(line.legacyItemId), ebayVariationId: optionalText(line.legacyVariationId),
      sku: optionalText(line.sku), title: requiredText(line.title, "title"),
      quantity: line.quantity!, sellTotal: value, currency, orderCreatedAt, orderModifiedAt,
    };
  });
}

export type OrderImportDependencies = {
  fetchPage: (filter: string, offset: number) => Promise<EbayOrdersPage>;
  saveLines: (lines: ImportedOrderLine[]) => Promise<number>;
  complete: (through: Date) => Promise<void>;
};

/** A failed page/write never commits the watermark; previously saved lines are safe to replay. */
export async function importEbayOrders(input: {
  activatedAt: Date; lastSyncedTo: Date | null; through: Date;
}, deps: OrderImportDependencies) {
  const start = new Date(Math.max(input.activatedAt.getTime(),
    (input.lastSyncedTo ?? input.activatedAt).getTime() - EBAY_ORDERS_OVERLAP_MS));
  if (input.through < start) throw new Error("Order sync clock moved backwards");
  const range = "[" + start.toISOString() + ".." + input.through.toISOString() + "]";
  // eBay ignores lastmodifieddate when creationdate is also supplied. Query separately.
  const filters = ["creationdate:" + range];
  if (input.lastSyncedTo) filters.push("lastmodifieddate:" + range);
  const importedKeys = new Set<string>();
  let fetched = 0, unmatched = 0;
  for (const filter of filters) {
    let offset = 0;
    while (true) {
      const page = await deps.fetchPage(filter, offset);
      if (!Array.isArray(page.orders)) throw new Error("Invalid eBay orders response");
      fetched += page.orders.length;
      const lines = page.orders.flatMap(order => normalizeEbayOrder(order, input.activatedAt));
      unmatched += await deps.saveLines(lines);
      for (const line of lines) importedKeys.add(line.ebayOrderId + "/" + line.lineItemId);
      if (!page.next && (page.total === undefined || offset + page.orders.length >= page.total)) break;
      if (page.orders.length === 0) throw new Error("eBay order pagination did not advance");
      // Rebuild requests locally; never send tokens to a next URL returned in a response.
      offset += EBAY_ORDERS_PAGE_SIZE;
    }
  }
  await deps.complete(input.through);
  return { fetchedOrders: fetched, savedLines: importedKeys.size, unmatchedLines: unmatched };
}
