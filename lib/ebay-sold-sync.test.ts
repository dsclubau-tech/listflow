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

test("ebay-sold-sync defines 24-hour cadence and schedule key", async () => {
  const { EBAY_SOLD_COUNT_SYNC_INTERVAL_MS, EBAY_SOLD_COUNT_SYNC_TASK_KEY } =
    await import("./ebay-sold-sync");
  assert.equal(EBAY_SOLD_COUNT_SYNC_TASK_KEY, "ebay-sold-count-sync");
  assert.equal(EBAY_SOLD_COUNT_SYNC_INTERVAL_MS, 24 * 60 * 60 * 1000);
});

test("getEbaySoldSyncUpdates identifies products with changed sold counts or view counts", async () => {
  const { getEbaySoldSyncUpdates } = await import("./ebay-sold-sync");
  const products = [
    { id: "p1", ebayItemId: "111", quantitySold: 0, ebayViewCount: 10 },
    { id: "p2", ebayItemId: "222", quantitySold: 5, ebayViewCount: 25 },
    { id: "p3", ebayItemId: "333", quantitySold: 10, ebayViewCount: null },
    { id: "p4", ebayItemId: "444", quantitySold: 2, ebayViewCount: 50 },
  ];

  const listings = [
    { itemId: "111", title: "Item 1", quantityAvailable: 2, quantitySold: 3, quantityTotal: 5, viewCount: 10 },
    { itemId: "222", title: "Item 2", quantityAvailable: 1, quantitySold: 5, quantityTotal: 6, viewCount: 25 },
    { itemId: "333", title: "Item 3", quantityAvailable: 0, quantitySold: 12, quantityTotal: 12, viewCount: 40 },
    { itemId: "444", title: "Item 4", quantityAvailable: 5, quantitySold: 2, quantityTotal: 7, viewCount: 75 },
  ];

  const updates = getEbaySoldSyncUpdates(products, listings);

  assert.deepEqual(updates, [
    { id: "p1", nextQuantitySold: 3, nextViewCount: 10 },
    { id: "p3", nextQuantitySold: 12, nextViewCount: 40 },
    { id: "p4", nextQuantitySold: 2, nextViewCount: 75 },
  ]);
});



