import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

test("Analytics listing IDs are deduplicated and split into 200-item batches", async () => {
  const { chunkEbayListingIds } = await import("./ebay-analytics");
  const ids = Array.from({ length: 336 }, (_, index) => String(index + 1));
  const batches = chunkEbayListingIds([...ids, "1", "", " 2 "]);
  assert.deepEqual(batches.map((batch) => batch.length), [200, 136]);
  assert.equal(new Set(batches.flat()).size, 336);
});

test("Analytics date range is the latest 30 Los Angeles calendar days", async () => {
  const { getEbayAnalyticsDateRange } = await import("./ebay-analytics");
  assert.deepEqual(
    getEbayAnalyticsDateRange(new Date("2026-03-08T07:30:00.000Z")),
    { start: "20260206", end: "20260307" },
  );
  assert.deepEqual(
    getEbayAnalyticsDateRange(new Date("2026-03-08T08:30:00.000Z")),
    { start: "20260207", end: "20260308" },
  );
});

test("traffic parser follows response metadata and distinguishes zero from unavailable", async () => {
  const { parseEbayTrafficReport } = await import("./ebay-analytics");
  const result = parseEbayTrafficReport({
    startDate: "2026-08-22T07:00:00.000Z",
    endDate: "2026-09-21T06:59:59.000Z",
    lastUpdatedDate: "2026-09-21T02:52:57.820Z",
    header: {
      dimensionKeys: [{ key: "OTHER" }, { key: "LISTING_ID" }],
      metrics: [{ key: "TRANSACTION" }, { key: "LISTING_VIEWS_TOTAL" }],
    },
    records: [
      {
        dimensionValues: [{ value: "x" }, { value: "positive" }],
        metricValues: [{ value: 1 }, { value: 34 }],
      },
      {
        dimensionValues: [{ value: "x" }, { value: "zero" }],
        metricValues: [{ value: 0 }, { value: 0, applicable: true }],
      },
      {
        dimensionValues: [{ value: "x" }, { value: "not-applicable" }],
        metricValues: [{ value: 0 }, { value: 12, applicable: false }],
      },
      {
        dimensionValues: [{ value: "x" }, { value: "malformed" }],
        metricValues: [{ value: 0 }, { value: "NaN" }],
      },
      {
        dimensionValues: [{ value: "x" }, { value: "null-metric" }],
        metricValues: [{ value: 0 }, { value: null }],
      },
    ],
  });

  assert.deepEqual(Array.from(result.viewsByListingId), [
    ["positive", 34],
    ["zero", 0],
  ]);
  assert.equal(result.startDate, "2026-08-22T07:00:00.000Z");
  assert.equal(result.lastUpdatedDate, "2026-09-21T02:52:57.820Z");
});

test("traffic parser rejects a response without the requested metric", async () => {
  const { parseEbayTrafficReport } = await import("./ebay-analytics");
  assert.throws(
    () =>
      parseEbayTrafficReport({
        header: {
          dimensionKeys: [{ key: "LISTING_ID" }],
          metrics: [{ key: "TRANSACTION" }],
        },
      }),
    /omitted listing or views metadata/,
  );
});

test("listing views preserve successful batches when a later batch fails", async () => {
  const { fetchEbayListingViews } = await import("./ebay-analytics");
  const listingIds = Array.from({ length: 336 }, (_, index) => String(index + 1));
  let calls = 0;
  const result = await fetchEbayListingViews(
    { storeId: "store-1", storeNumber: 1, listingIds },
    {
      fetchBatch: async (batch) => {
        calls += 1;
        if (calls === 2) throw new Error("temporary timeout");
        return {
          viewsByListingId: new Map(batch.map((id) => [id, Number(id)])),
          startDate: "2026-08-22T07:00:00.000Z",
          endDate: "2026-09-21T06:59:59.000Z",
          lastUpdatedDate: "2026-09-21T02:52:57.820Z",
          warnings: [],
        };
      },
    },
  );

  assert.equal(result.successfulBatches, 1);
  assert.equal(result.failedBatches, 1);
  assert.equal(result.viewsByListingId.size, 200);
  assert.deepEqual(result.errors, ["temporary timeout"]);
});

test("authorization failure stops remaining listing batches", async () => {
  const {
    EbayAnalyticsAuthorizationError,
    fetchEbayListingViews,
  } = await import("./ebay-analytics");
  let calls = 0;
  const result = await fetchEbayListingViews(
    {
      storeId: "store-1",
      storeNumber: 1,
      listingIds: Array.from({ length: 336 }, (_, index) => String(index + 1)),
    },
    {
      fetchBatch: async () => {
        calls += 1;
        throw new EbayAnalyticsAuthorizationError();
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.authorizationRequired, true);
  assert.equal(result.failedBatches, 1);
});
