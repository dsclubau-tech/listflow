import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function patchFixture(authenticated = true) {
  const writes: Array<{ where: { id: string; storeId: string }; data: Record<string, unknown> }> = [];
  const route = await loadMockedModule<typeof import("../app/api/orders/[id]/route")>("app/api/orders/[id]/route.ts", {
    "@/lib/store-session": { getCurrentStoreSession: async () => authenticated ? { storeId: "store" } : null },
    "@/lib/prisma": { prisma: { ebayOrderLine: { updateMany: async (args: typeof writes[number]) => {
      writes.push(args); return { count: args.where.id === "owned" ? 1 : 0 };
    } } } },
    "@/lib/logger": { logger: { error() {} } },
  });
  return { route, writes };
}
function request(body: unknown) { return new Request("https://listflow.test/api/orders/owned", { method: "PATCH", body: JSON.stringify(body) }); }

test("unauthenticated edits never reach storage", async () => {
  const f = await patchFixture(false);
  assert.equal((await f.route.PATCH(request({ status: "SHIPPED" }), { params: Promise.resolve({ id: "owned" }) })).status, 401);
  assert.equal(f.writes.length, 0);
});

test("manual edits always constrain storage to the authenticated store", async () => {
  const f = await patchFixture();
  const response = await f.route.PATCH(request({ status: "ORDERED", estimatedArrival: "2026-10-12" }), { params: Promise.resolve({ id: "owned" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].where)),  { id: "owned", storeId: "store" });
  assert.deepEqual(await response.json(), { id: "owned", status: "ORDERED", estimatedArrival: "2026-10-12" });
  assert.equal((await f.route.PATCH(request({ status: "DELIVERED" }), { params: Promise.resolve({ id: "foreign" }) })).status, 404);
});

test("unapproved fields and invalid dates/statuses are rejected before storage", async () => {
  const f = await patchFixture();
  for (const body of [{ storeId: "other", status: "SHIPPED" }, { sellTotal: 1 }, { estimatedArrival: "2026-02-30" }, { status: "Unmonitored" }]) {
    assert.equal((await f.route.PATCH(request(body), { params: Promise.resolve({ id: "owned" }) })).status, 400);
  }
  assert.equal(f.writes.length, 0);
});

test("list endpoint uses session ownership, normalized pagination, and private uncached responses", async () => {
  let args: unknown[] = [];
  const route = await loadMockedModule<typeof import("../app/api/orders/route")>("app/api/orders/route.ts", {
    "@/lib/store-session": { getCurrentStoreSession: async () => ({ storeId: "session-store" }) },
    "@/lib/orders-data": {
      normalizeOrdersPagination: () => ({ page: 2, pageSize: 50 }),
      getOrdersPageData: async (...values: unknown[]) => { args = values; return { rows: [], storeId: values[0] }; },
    },
    "@/lib/logger": { logger: { error() {} } },
  }, { URL });
  const response = await route.GET(new Request("https://listflow.test/api/orders?storeId=other&page=2"));
  assert.equal(response.status, 200);
  assert.deepEqual(args, ["session-store", 2, 50]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("list endpoint requires a session", async () => {
  const route = await loadMockedModule<typeof import("../app/api/orders/route")>("app/api/orders/route.ts", {
    "@/lib/store-session": { getCurrentStoreSession: async () => null },
    "@/lib/orders-data": { normalizeOrdersPagination() { throw new Error("unexpected"); }, getOrdersPageData() { throw new Error("unexpected"); } },
    "@/lib/logger": { logger: { error() {} } },
  }, { URL });
  assert.equal((await route.GET(new Request("https://listflow.test/api/orders"))).status, 401);
});
