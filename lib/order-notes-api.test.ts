import assert from "node:assert/strict";
import test from "node:test";
import { orderGroupKey } from "./order-notes";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function fixture(authenticated = true) {
  const identity = { storeId: "store", accountKey: "production:store:1", ebayOrderId: "order" };
  const lookups: Array<{ where: { id: string; storeId: string } }> = [];
  const writes: Array<{ where: { storeId_accountKey_ebayOrderId: typeof identity };
    create: typeof identity & { internalNote: string | null }; update: { internalNote: string | null } }> = [];
  let fail = false;
  const route = await loadMockedModule<typeof import("../app/api/orders/[id]/note/route")>("app/api/orders/[id]/note/route.ts", {
    "@/lib/store-session": { getCurrentStoreSession: async () => authenticated ? { storeId: "store" } : null },
    "@/lib/prisma": { prisma: {
      ebayOrderLine: { findFirst: async (args: typeof lookups[number]) => {
        lookups.push(args); return ["owned", "sibling"].includes(args.where.id) ? identity : null;
      } },
      ebayOrderNote: { upsert: async (args: typeof writes[number]) => {
        if (fail) throw new Error("Database unavailable"); writes.push(args); return args.update;
      } },
    } },
    "@/lib/logger": { logger: { warn() {} } },
  });
  function patch(body: unknown, id = "owned") {
    return route.PATCH(new Request("https://listflow.test/api/orders/" + id + "/note", {
      method: "PATCH", body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
  }
  return { patch, lookups, writes, identity, fail: () => { fail = true; } };
}

test("note endpoint requires authentication and store ownership before writing", async () => {
  const unauth = await fixture(false);
  assert.equal((await unauth.patch({ internalNote: "note" })).status, 401);
  assert.equal(unauth.lookups.length, 0); assert.equal(unauth.writes.length, 0);
  const f = await fixture();
  assert.equal((await f.patch({ internalNote: "note" }, "foreign")).status, 404);
  assert.deepEqual(JSON.parse(JSON.stringify(f.lookups[0].where)), { id: "foreign", storeId: "store" });
  assert.equal(f.writes.length, 0);
});

test("saving through either row upserts the same order note and returns canonical text", async () => {
  const f = await fixture();
  const response = await f.patch({ internalNote: "  Line one\nLine two  " });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { internalNote: "Line one\nLine two", orderGroupKey: orderGroupKey(f.identity) });
  await f.patch({ internalNote: " \n " }, "sibling");
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].where)), { storeId_accountKey_ebayOrderId: f.identity });
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[1].where)), JSON.parse(JSON.stringify(f.writes[0].where)));
  assert.equal(f.writes[1].update.internalNote, null);
});

test("note endpoint rejects forged identities and unrelated order/product changes", async () => {
  const f = await fixture();
  for (const body of [{ internalNote: "note", accountKey: "other" }, { internalNote: "note", storeId: "other" },
    { internalNote: "note", ebayOrderId: "other" }, { internalNote: "note", orderGroupKey: "other" },
    { internalNote: false }, { status: "ORDERED" }, {}]) {
    assert.equal((await f.patch(body)).status, 400);
  }
  assert.equal(f.lookups.length, 0); assert.equal(f.writes.length, 0);
});

test("failed note saves return an actionable error without exposing note contents", async () => {
  const f = await fixture(); f.fail();
  const response = await f.patch({ internalNote: "Private supplier information" });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /Please try again/);
  assert.ok(!body.error.includes("Private"));
});
