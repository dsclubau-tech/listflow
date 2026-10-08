import assert from "node:assert/strict";
import test from "node:test";
import { importEbayOrders, normalizeEbayOrder, type EbayOrderPayload, type ImportedOrderLine } from "./ebay-orders-import";

const activation = new Date("2026-10-08T00:00:00Z");
const through = new Date("2026-10-08T00:10:00Z");
function order(id = "order"): EbayOrderPayload {
  return { orderId: id, creationDate: "2026-10-08T00:02:00Z", lastModifiedDate: "2026-10-08T00:03:00Z",
    lineItems: [{ lineItemId: "line", legacyItemId: "123", title: "Item", quantity: 2, lineItemCost: { value: "50.00", currency: "AUD" } }] };
}

test("imports line totals once, respecting discounts and multiple products", () => {
  const payload = order();
  payload.lineItems!.push({ ...payload.lineItems![0], lineItemId: "second", quantity: 3, discountedLineItemCost: { value: "40.00", currency: "AUD" } });
  const rows = normalizeEbayOrder(payload, activation);
  assert.equal(rows[0].sellTotal, "50.00");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[1].sellTotal, "40.00");
  assert.equal(rows[1].quantity, 3);
});

test("pre-activation orders are excluded even when modified later", () => {
  assert.deepEqual(normalizeEbayOrder({ ...order(), creationDate: "2026-10-07T23:59:59Z" }, activation), []);
  const boundary = normalizeEbayOrder({ ...order(), creationDate: activation.toISOString() }, activation);
  assert.equal(boundary.length, 1);
});

test("missing/invalid money, identities, quantity or timestamps fail instead of advancing past bad data", () => {
  const bad = [ { ...order(), orderId: "" }, { ...order(), creationDate: "bad" }, { ...order(), lineItems: [] } ];
  for (const payload of bad) assert.throws(() => normalizeEbayOrder(payload, activation));
  for (const value of ["", "-1", "NaN", "12.345"]) {
    const payload = order(); payload.lineItems![0].lineItemCost!.value = value;
    assert.throws(() => normalizeEbayOrder(payload, activation));
  }
});

test("all pages and separate created/modified streams complete before cursor commit", async () => {
  const calls: Array<{ filter: string; offset: number }> = [];
  const saved: ImportedOrderLine[] = [];
  let committed: Date | null = null;
  const result = await importEbayOrders({ activatedAt: activation, lastSyncedTo: new Date("2026-10-08T00:05:00Z"), through }, {
    fetchPage: async (filter, offset) => {
      calls.push({ filter, offset });
      if (filter.startsWith("lastmodifieddate")) return { orders: [order("updated")], total: 1 };
      return offset === 0 ? { orders: [order()], total: 101, next: "https://untrusted.test/next" } : { orders: [order("second")], total: 101 };
    },
    saveLines: async lines => { saved.push(...lines); return 0; },
    complete: async date => { committed = date; },
  });
  assert.equal(result.savedLines, 3);
  assert.deepEqual(calls.map(call => call.offset), [0, 100, 0]);
  assert.match(calls[0].filter, /00:03:00.000Z/);
  assert.ok(!calls[0].filter.includes("lastmodifieddate"));
  assert.equal(saved.length, 3);
  assert.equal(committed, through);
});

test("partial failures preserve cursor and safely replay saved lines", async () => {
  const records = new Map<string, ImportedOrderLine>();
  let committed = false, fail = true;
  const deps = {
    fetchPage: async (_filter: string, offset: number) => {
      if (offset > 0 && fail) throw new Error("temporary failure");
      return offset === 0 ? { orders: [order()], total: 101, next: "next" } : { orders: [order("second")], total: 101 };
    },
    saveLines: async (lines: ImportedOrderLine[]) => {
      for (const line of lines) records.set(line.ebayOrderId + "/" + line.lineItemId, line);
      return 0;
    },
    complete: async () => { committed = true; },
  };
  await assert.rejects(importEbayOrders({ activatedAt: activation, lastSyncedTo: null, through }, deps), /temporary/);
  assert.equal(committed, false); assert.equal(records.size, 1);
  fail = false;
  await importEbayOrders({ activatedAt: activation, lastSyncedTo: null, through }, deps);
  assert.equal(committed, true); assert.equal(records.size, 2);
});

test("malformed/nonadvancing pagination does not commit", async () => {
  let committed = false;
  await assert.rejects(importEbayOrders({ activatedAt: activation, lastSyncedTo: null, through }, {
    fetchPage: async () => ({ orders: [], next: "next", total: 5 }),
    saveLines: async () => 0, complete: async () => { committed = true; },
  }), /pagination/);
  assert.equal(committed, false);
});
