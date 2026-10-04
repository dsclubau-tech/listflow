import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

type Snapshot = { userId: string; status: string; allowedStores: number; checkedAt: Date };
const oldSnapshot = (): Snapshot => ({ userId: "user-1", status: "ACTIVE", allowedStores: 3, checkedAt: new Date(0) });
async function fixture(options: {
  snapshot?: Snapshot | null; replies?: (Response | { thrown: unknown })[];
  persistenceError?: { thrown: unknown }; token?: string; deferredResponse?: Promise<Response>;
} = {}) {
  const calls: RequestInit[] = [], waits: number[] = [], timeouts: number[] = [], saved: Snapshot[] = [];
  let reads = 0;
  const implementation = await loadMockedModule<typeof import("./aa-entitlement")>("lib/aa-entitlement.ts", {
    "@/lib/prisma": { prisma: { entitlementSnapshot: {
      async findUnique() { reads++; return options.snapshot ?? null; },
      async upsert({ create }: { create: Snapshot }) {
        if (options.persistenceError) throw options.persistenceError.thrown;
        saved.push(create);
        return create;
      },
    } } },
  }, {
    process: { env: { AA_ENTITLEMENT_BEARER_TOKEN: options.token ?? "test-token ignored-suffix", AA_ENTITLEMENT_CHECK_URL: "http://aa.test/check" } },
    fetch: async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (options.deferredResponse) return (await options.deferredResponse).clone();
      const reply = options.replies?.[calls.length - 1];
      if (!reply) throw new Error("Unexpected mock fetch");
      if (reply instanceof Response) return reply;
      throw reply.thrown;
    },
    AbortSignal: { timeout(ms: number) { timeouts.push(ms); return AbortSignal.timeout(ms); } },
    setTimeout(callback: () => void, ms: number) { waits.push(ms); queueMicrotask(callback); return 0; },
  });
  return { implementation, calls, waits, timeouts, saved, reads: () => reads };
}
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });

for (const [label, body, expected] of [
  ["active", { status: "active", count: 4 }, { status: "ACTIVE", allowedStores: 4 }],
  ["missing count", { status: "active" }, { status: "ACTIVE", allowedStores: 1 }],
  ["malformed count", { status: "active", count: "4" }, { status: "ACTIVE", allowedStores: 1 }],
  ["null count", { status: "active", count: null }, { status: "ACTIVE", allowedStores: 1 }],
  ["inactive", { status: "inactive", count: 4 }, { status: "INACTIVE", allowedStores: 0 }],
  ["unavailable", { status: "unavailable" }, { status: "UNAVAILABLE", allowedStores: 3 }],
] as const) {
  test(`real subscription service preserves ${label} response`, async () => {
    const f = await fixture({ replies: [response(body)] });
    assert.deepEqual({ ...await f.implementation.fetchEntitlementFromAA("user-1", oldSnapshot()) }, expected);
    assert.deepEqual(f.timeouts, [5000]);
    assert.equal(f.calls[0].method, "POST");
    assert.deepEqual(JSON.parse(String(f.calls[0].body)), { user_id: "user-1", product_slug: "listflow" });
    assert.equal(new Headers(f.calls[0].headers).get("authorization"), "Bearer test-token");
  });
}
for (const body of [{ error: "user_not_found" }, { message: "user_not_found" }]) {
  test(`real subscription explicit identity 404: ${JSON.stringify(body)}`, async () => {
    const f = await fixture({ replies: [response(body, 404)] });
    assert.equal((await f.implementation.fetchEntitlementFromAA("user-1", oldSnapshot())).status, "INACTIVE");
    assert.equal(f.calls.length, 1);
  });
}
for (const body of [null, [], "user_not_found", { error: 404 }, { error: "gateway" }]) {
  test(`real subscription gateway 404 preserves access count: ${JSON.stringify(body)}`, async () => {
    const f = await fixture({ replies: [response(body, 404)] });
    assert.deepEqual({ ...await f.implementation.fetchEntitlementFromAA("user-1", oldSnapshot()) }, { status: "UNAVAILABLE", allowedStores: 3 });
    assert.equal(f.calls.length, 1);
  });
}
test("real subscription non-JSON gateway 404 remains unavailable", async () => {
  const f = await fixture({ replies: [new Response("<html>gateway</html>", { status: 404 })] });
  assert.equal((await f.implementation.fetchEntitlementFromAA("user-1")).status, "UNAVAILABLE");
});
for (const status of [401, 403]) {
  test(`real subscription machine authentication ${status} retains cached count without retry`, async () => {
    const f = await fixture({ replies: [response({}, status)] });
    assert.deepEqual({ ...await f.implementation.fetchEntitlementFromAA("user-1", oldSnapshot()) }, { status: "UNAVAILABLE", allowedStores: 3 });
    assert.equal(f.calls.length, 1);
  });
}
for (const status of [429, 503]) {
  test(`real subscription ${status} retries once with existing backoff`, async () => {
    const f = await fixture({ replies: [response({}, status, { "Retry-After": "20" }), response({ status: "active", count: 2 })] });
    assert.equal((await f.implementation.fetchEntitlementFromAA("user-1")).status, "ACTIVE");
    assert.equal(f.calls.length, 2);
    assert.equal(f.waits.length, 1);
    assert.ok(f.waits[0] >= (status === 429 ? 5000 : 500));
    assert.ok(f.waits[0] <= (status === 429 ? 5500 : 1500));
  });
}
for (const thrown of [new Error("timeout"), "offline", null, { message: 42, code: false }]) {
  test(`real subscription safely retries unexpected thrown value ${String(thrown)}`, async () => {
    const f = await fixture({ replies: [{ thrown }, { thrown }] });
    assert.deepEqual({ ...await f.implementation.fetchEntitlementFromAA("user-1", oldSnapshot()) }, { status: "UNAVAILABLE", allowedStores: 3 });
    assert.equal(f.calls.length, 2);
    assert.equal(f.waits.length, 1);
  });
}
test("real subscription missing machine token makes no request", async () => {
  const f = await fixture({ token: "" });
  assert.equal((await f.implementation.fetchEntitlementFromAA("user-1")).status, "UNAVAILABLE");
  assert.equal(f.calls.length, 0);
});
test("real entitlement fresh cache avoids external requests and persistence", async () => {
  const snapshot = { ...oldSnapshot(), checkedAt: new Date() };
  const f = await fixture({ snapshot });
  const result = await f.implementation.getOrRefreshEntitlement("user-1");
  assert.equal(result.source, "cache");
  assert.equal(result.checkedAt, snapshot.checkedAt);
  assert.equal(f.calls.length, 0);
  assert.equal(f.saved.length, 0);
});
test("real entitlement forced refresh bypasses fresh cache", async () => {
  const f = await fixture({ snapshot: { ...oldSnapshot(), checkedAt: new Date() }, replies: [response({ status: "inactive" })] });
  const result = await f.implementation.getOrRefreshEntitlement("user-1", { forceRefresh: true });
  assert.equal(result.status, "INACTIVE");
  assert.equal(result.allowedStores, 0);
  assert.equal(result.source, "live");
  assert.equal(f.saved.length, 1);
});
test("real entitlement stale active cache survives service unavailability", async () => {
  const f = await fixture({ snapshot: oldSnapshot(), replies: [response({ status: "unavailable" })] });
  const result = await f.implementation.getOrRefreshEntitlement("user-1");
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.allowedStores, 3);
  assert.equal(f.saved[0].status, "ACTIVE");
});
for (const snapshot of [oldSnapshot(), null]) {
  test(`real entitlement persistence failure falls back ${snapshot ? "to cache" : "safely without cache"}`, async () => {
    const f = await fixture({ snapshot, persistenceError: { thrown: null }, replies: [response({ status: "active", count: 5 })] });
    const result = await f.implementation.getOrRefreshEntitlement("user-1");
    assert.equal(result.source, snapshot ? "cache" : "fallback");
    assert.equal(result.status, snapshot ? "ACTIVE" : "UNAVAILABLE");
    assert.equal(result.allowedStores, snapshot ? 3 : 0);
  });
}
test("real entitlement concurrent requests share one network call and release the flight after completion", async () => {
  let release!: (reply: Response) => void;
  const deferredResponse = new Promise<Response>(resolve => { release = resolve; });
  const f = await fixture({ deferredResponse });
  const a = f.implementation.getOrRefreshEntitlement("user-1");
  const b = f.implementation.getOrRefreshEntitlement("user-1");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  release(response({ status: "active", count: 2 }));
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first, second);
  assert.equal(f.saved.length, 1);
  await f.implementation.getOrRefreshEntitlement("user-1", { forceRefresh: true });
  assert.equal(f.calls.length, 2);
});
