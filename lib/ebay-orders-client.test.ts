import assert from "node:assert/strict";
import test from "node:test";
import { loadMockedModule } from "../tests/helpers/mocked-module";

async function fixture(responses: Response[]) {
  const urls: URL[] = [], tokens: string[] = [], backoffs: number[] = [];
  let cleared = 0, exchanged = 0;
  const client = await loadMockedModule<typeof import("./ebay-orders-client")>("lib/ebay-orders-client.ts", {
    "server-only": {},
    "@/lib/ebay": {
      EBAY_API_BASE_URL: "https://api.ebay.test",
      getOAuthAccessToken: async () => "token-" + (++exchanged),
      clearOAuthAccessTokenCache: () => { cleared++; },
    },
    "@/lib/ebay-rate-limit": {
      waitForEbayRateLimit: async () => {},
      recordEbayRateLimitBackoff: async (_store: string, _kind: string, _error: unknown, delay: number) => { backoffs.push(delay); },
    },
  }, { URL, URLSearchParams, fetch: async (url: URL, init: RequestInit) => {
    urls.push(url); tokens.push((init.headers as Record<string, string>).Authorization);
    const response = responses.shift(); assert.ok(response); return response;
  } });
  return { client, urls, tokens, backoffs, cleared: () => cleared };
}
const input = { storeId: "store", storeNumber: 1 as const, filter: "creationdate:[2026-10-08T00:00:00Z..]", offset: 100 };

test("fulfillment request preserves filters/pagination and refreshes an expired token once", async () => {
  const f = await fixture([new Response("", { status: 401 }), Response.json({ orders: [], total: 0 })]);
  await f.client.fetchEbayOrdersPage(input);
  assert.equal(f.cleared(), 1);
  assert.deepEqual(f.tokens, ["Bearer token-1", "Bearer token-2"]);
  assert.equal(f.urls[0].pathname, "/sell/fulfillment/v1/order");
  assert.equal(f.urls[0].searchParams.get("offset"), "100");
  assert.equal(f.urls[0].searchParams.get("limit"), "100");
  assert.equal(f.urls[0].searchParams.get("filter"), input.filter);
});

test("missing permission is reported without retrying or leaking eBay response data", async () => {
  const f = await fixture([new Response("sensitive body", { status: 403 })]);
  await assert.rejects(f.client.fetchEbayOrdersPage(input), /fulfillment read permission/);
  assert.equal(f.urls.length, 1);
});

test("rate limiting defers the next scheduled run using Retry-After", async () => {
  const f = await fixture([new Response("", { status: 429, headers: { "Retry-After": "600" } })]);
  await assert.rejects(f.client.fetchEbayOrdersPage(input), error => {
    assert.ok(error instanceof f.client.EbayOrdersRequestError);
    assert.equal(error.retryAfterMs, 600_000); return true;
  });
  assert.deepEqual(f.backoffs, [600_000]);
});

test("temporary server errors are retryable and do not masquerade as empty orders", async () => {
  const f = await fixture([new Response("", { status: 503 })]);
  await assert.rejects(f.client.fetchEbayOrdersPage(input), /HTTP 503/);
});
