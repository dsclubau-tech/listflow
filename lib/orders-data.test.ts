import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function fixture(disconnected = false) {
  let products: Array<Record<string, unknown>> = [];
  let cost = 10;
  const queries: Array<{ model: string; args: Record<string, unknown> }> = [];
  const line = { id: "line", storeId: "store", accountKey: "production:store:1", ebayOrderId: "order", productId: "stale-product", ebayItemId: "123", ebayVariationId: null, sku: "sku", title: "Purchased", quantity: 2,
    sellTotal: "50.00", currency: "AUD", status: "ORDERED", estimatedArrival: "2026-10-12" };
  let lines = [line];
  let notes: Array<{ storeId: string; accountKey: string; ebayOrderId: string; internalNote: string | null }> = [];
  const product = { id: "product", storeId: "store", ebayItemId: "123", asin: "B012345678", amazonPrice: 10,
    images: ["image.jpg"], promotedAdStatus: "NOT_PROMOTED", promotedAdPercent: 0, promotedAdRateStrategy: "FIXED" };
  const data = await loadMockedModule<typeof import("./orders-data")>("lib/orders-data.ts", {
    "server-only": {},
    "@/lib/ebay": { ebayConfig: { environment: "production" }, getStoreNumber: async () => { if (disconnected) throw new Error("Disconnected"); return 1; } },
    "@/lib/prisma": { prisma: {
      ebayOrderLine: {
        count: async (args: Record<string, unknown>) => { queries.push({ model: "count", args }); return lines.length; },
        findMany: async (args: Record<string, unknown>) => { queries.push({ model: "lines", args }); return lines.slice(Number(args.skip), Number(args.skip) + Number(args.take)); },
      },
      ebayOrderNote: { findMany: async (args: Record<string, unknown>) => {
        queries.push({ model: "notes", args });
        const where = args.where as { storeId: string; OR: Array<{ accountKey: string; ebayOrderId: string }> };
        return notes.filter(note => note.storeId === where.storeId && where.OR.some(order =>
          order.accountKey === note.accountKey && order.ebayOrderId === note.ebayOrderId));
      } },
      ebayOrderSyncState: { findUnique: async () => ({ activatedAt: new Date("2026-10-08T00:00:00Z"), lastSuccessAt: null, lastError: null }) },
      product: { findMany: async (args: Record<string, unknown>) => {
        queries.push({ model: "products", args });
        return products.map(value => ({ ...value, variants: [{ id: "variant", sku: "sku", buyPrice: cost, feesPercent: 10, feesFixed: 0.3, images: [] }] }));
      } },
    } },
  });
  return { data, queries, match: () => { products = [product]; }, changeCost: (value: number) => { cost = value; },
    setLines: (values: typeof lines) => { lines = values; }, setNotes: (values: typeof notes) => { notes = values; }, line };
}

test("each read uses current costs and can resolve previously unmatched orders", async () => {
  const f = await fixture();
  assert.equal((await f.data.getOrdersPageData("store")).rows[0].profit, null);
  assert.equal((await f.data.getOrdersPageData("store")).rows[0].matchedProductId, null);
  f.match();
  let row = (await f.data.getOrdersPageData("store")).rows[0];
  assert.equal(row.matchedProductId, "product");
  assert.equal(row.buyTotal, 20); assert.equal(row.profit, 24.4);
  f.changeCost(12);
  row = (await f.data.getOrdersPageData("store")).rows[0];
  assert.equal(row.buyTotal, 24); assert.equal(row.profit, 20.4);
  assert.equal(row.status, "ORDERED"); assert.equal(row.estimatedArrival, "2026-10-12");
});

test("line and product reads are constrained to the selected store and account", async () => {
  const f = await fixture();
  const result = await f.data.getOrdersPageData("store", 999, 20);
  assert.equal(result.page, 1);
  for (const query of f.queries) {
    const where = query.args.where as { storeId: string; accountKey?: string };
    assert.equal(where.storeId, "store");
    if (query.model === "count" || query.model === "lines") assert.equal(where.accountKey, "production:store:1");
  }
  const normalized = f.data.normalizeOrdersPagination("invalid", 5);
  assert.equal(normalized.page, 1); assert.equal(normalized.pageSize, 50);
});


test("one batched note read shares text across rows and pagination, even without a product match", async () => {
  const f = await fixture();
  f.setLines(Array.from({ length: 11 }, (_, index) => ({ ...f.line, id: "line-" + index })));
  f.setNotes([{ storeId: "store", accountKey: "production:store:1", ebayOrderId: "order", internalNote: "Supplier note" }]);
  const first = await f.data.getOrdersPageData("store", 1, 10);
  const second = await f.data.getOrdersPageData("store", 2, 10);
  assert.equal(first.rows.length, 10); assert.equal(second.rows.length, 1);
  for (const row of [...first.rows, ...second.rows]) {
    assert.equal(row.internalNote, "Supplier note"); assert.equal(row.matchedProductId, null);
    assert.equal(row.orderGroupKey, first.rows[0].orderGroupKey);
  }
  const noteReads = f.queries.filter(query => query.model === "notes");
  assert.equal(noteReads.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(noteReads[0].args.where)), {
    storeId: "store", OR: [{ accountKey: "production:store:1", ebayOrderId: "order" }],
  });
});

test("notes remain isolated by order and account when reading retained disconnected orders", async () => {
  const f = await fixture(true);
  f.setLines([f.line, { ...f.line, id: "other-account", accountKey: "production:store:2" },
    { ...f.line, id: "other-order", ebayOrderId: "another" }]);
  f.setNotes([{ storeId: "store", accountKey: "production:store:1", ebayOrderId: "order", internalNote: "Account one" },
    { storeId: "store", accountKey: "production:store:2", ebayOrderId: "order", internalNote: "Account two" },
    { storeId: "foreign", accountKey: "production:store:1", ebayOrderId: "another", internalNote: "Private foreign note" }]);
  const result = await f.data.getOrdersPageData("store");
  assert.deepEqual(result.rows.map(row => row.internalNote), ["Account one", "Account two", null]);
  assert.equal(new Set(result.rows.map(row => row.orderGroupKey)).size, 3);
});
