import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function fixture(options: { userId?: string; legacy?: boolean; thrown?: { value: unknown } } = {}) {
  const calls: { userId: string; options: unknown }[] = [];
  const checkedAt = new Date("2026-01-01T00:00:00Z");
  const implementation = await loadMockedModule<typeof import("../app/api/entitlement/refresh/route")>("app/api/entitlement/refresh/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.userId ? { id: options.userId } : null } }) } }) },
    "@/auth": { auth: async () => options.legacy ? { user: { storeId: "store-1" } } : null },
    "@/lib/prisma": { prisma: { store: { findUnique: async () => ({ ownerUserId: "legacy-owner" }) } } },
    "@/lib/aa-entitlement": { getOrRefreshEntitlement: async (userId: string, refresh: unknown) => {
      calls.push({ userId, options: refresh });
      if (options.thrown) throw options.thrown.value;
      return { status: "ACTIVE", allowedStores: 3, checkedAt };
    } },
  });
  return { implementation, calls, checkedAt };
}
for (const legacy of [false, true]) {
  test(`real refresh API preserves ${legacy ? "legacy" : "Supabase"} successful response`, async () => {
    const f = await fixture({ userId: legacy ? undefined : "user-1", legacy });
    const result = await f.implementation.POST();
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { success: true, status: "ACTIVE", allowedStores: 3, checkedAt: f.checkedAt.toISOString() });
    assert.equal(f.calls[0].userId, legacy ? "legacy-owner" : "user-1");
    assert.equal((f.calls[0].options as { forceRefresh: boolean }).forceRefresh, true);
  });
}
test("real refresh API unauthenticated response makes no refresh request", async () => {
  const f = await fixture();
  const result = await f.implementation.POST();
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "Unauthorized: No authenticated user session found." });
  assert.equal(f.calls.length, 0);
});
for (const value of [new Error("failed"), null, { message: 12 }, "offline"]) {
  test(`real refresh API unexpected failures preserve generic 500 response: ${String(value)}`, async () => {
    const f = await fixture({ userId: "user-1", thrown: { value } });
    const result = await f.implementation.POST();
    assert.equal(result.status, 500);
    assert.deepEqual(await result.json(), { error: "Failed to refresh subscription status. Please try again." });
  });
}
