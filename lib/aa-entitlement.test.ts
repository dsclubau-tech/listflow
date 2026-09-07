import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { fetchEntitlementFromAA } from "./aa-entitlement";

// Backup global fetch
const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  process.env.AA_ENTITLEMENT_BEARER_TOKEN = "test_bearer_token";
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetchEntitlementFromAA - 200 active with count returns ACTIVE and allowedStores", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "active",
        count: 3,
        user_id: "user-123",
        product_slug: "listflow",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const result = await fetchEntitlementFromAA("user-123");
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.allowedStores, 3);
});

test("fetchEntitlementFromAA - 200 inactive returns INACTIVE and allowedStores 0", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "inactive",
        count: 0,
        user_id: "user-123",
        product_slug: "listflow",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const result = await fetchEntitlementFromAA("user-123", {
    status: "ACTIVE",
    allowedStores: 2,
  });

  assert.equal(result.status, "INACTIVE");
  assert.equal(result.allowedStores, 0);
});

test("fetchEntitlementFromAA - 503 unavailable preserves last-known allowedStores", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(JSON.stringify({ status: "unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await fetchEntitlementFromAA("user-123", {
    status: "ACTIVE",
    allowedStores: 2,
  });

  // Must have attempted retry on 503
  assert.equal(callCount, 2);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.allowedStores, 2);
});

test("fetchEntitlementFromAA - 404 user_not_found fails closed without retry", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(JSON.stringify({ error: "user_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await fetchEntitlementFromAA("user-123", {
    status: "ACTIVE",
    allowedStores: 1,
  });

  // Must not loop retries on 404
  assert.equal(callCount, 1);
  assert.equal(result.status, "INACTIVE");
  assert.equal(result.allowedStores, 0);
});

test("fetchEntitlementFromAA - 404 gateway/infrastructure error treats as UNAVAILABLE and preserves last-known allowedStores", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(
      JSON.stringify({ code: "NOT_FOUND", message: "Requested function was not found" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const result = await fetchEntitlementFromAA("user-123", {
    status: "ACTIVE",
    allowedStores: 3,
  });

  assert.equal(callCount, 1);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.allowedStores, 3);
});

test("fetchEntitlementFromAA - 401/403 machine token error preserves last-known snapshot (like 503)", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  // With existing snapshot: preserves allowedStores to avoid fleet lockout
  const withSnapshot = await fetchEntitlementFromAA("user-123", {
    status: "ACTIVE",
    allowedStores: 2,
  });

  assert.equal(callCount, 1);
  assert.equal(withSnapshot.status, "UNAVAILABLE");
  assert.equal(withSnapshot.allowedStores, 2);

  // Without existing snapshot: fails closed safely with allowedStores 0
  const withoutSnapshot = await fetchEntitlementFromAA("new-user-456", null);
  assert.equal(withoutSnapshot.status, "UNAVAILABLE");
  assert.equal(withoutSnapshot.allowedStores, 0);
});

test("fetchEntitlementFromAA - 429 rate limit retries and respects Retry-After", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "Retry-After": "1", "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ status: "active", count: 1 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await fetchEntitlementFromAA("user-123");
  assert.equal(callCount, 2);
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.allowedStores, 1);
});
