import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function fixture() {
  let products: Array<Record<string, unknown>> = [];
  let cost = 10;
  const queries: Array<{ model: string; args: Record<string, unknown> }> = [];
  const line = { id: "line", ebayItemId: "123", ebayVariationId: null, sku: "sku", title: "Purchased", quantity: 2,
    sellTotal: "50.00", currency: "AUD", status: "ORDERED", estimatedArrival: "2026-10-12" };
  const product = { id: "product", storeId: "store", ebayItemId: "123", asin: "B012345678", amazonPrice: 10,
    images: ["image.jpg"], promotedAdStatus: "NOT_PROMOTED", promotedAdPercent: 0, promotedAdRateStrategy: "FIXED" };
  const data = await loadMockedModule<typeof import("./orders-data")>("lib/orders-data.ts", {
    "server-only": {},
    "@/lib/ebay": { ebayConfig: { environment: "production" }, getStoreNumber: async () => 1 },
    "@/lib/prisma": { prisma: {
      ebayOrderLine: {
        count: async (args: Record<string, unknown>) => { queries.push({ model: "count", args }); return 1; },
        findMany: async (args: Record<string, unknown>) => { queries.push({ model: "lines", args }); return [line]; },
      },
      ebayOrderSyncState: { findUnique: async () => ({ activatedAt: new Date("2026-10-08T00:00:00Z"), lastSuccessAt: null, lastError: null }) },
      product: { findMany: async (args: Record<string, unknown>) => {
        queries.push({ model: "products", args });
        return products.map(value => ({ ...value, variants: [{ id: "variant", sku: "sku", buyPrice: cost, feesPercent: 10, feesFixed: 0.3, images: [] }] }));
      } },
    } },
  });
  return { data, queries, match: () => { products = [product]; }, changeCost: (value: number) => { cost = value; } };
}

test("each read uses current costs and can resolve previously unmatched orders", async () => {
  const f = await fixture();
  assert.equal((await f.data.getOrdersPageData("store")).rows[0].profit, null);
  f.match();
  let row = (await f.data.getOrdersPageData("store")).rows[0];
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
    if (query.model !== "products") assert.equal(where.accountKey, "production:store:1");
  }
  const normalized = f.data.normalizeOrdersPagination("invalid", 5);
  assert.equal(normalized.page, 1); assert.equal(normalized.pageSize, 50);
});
