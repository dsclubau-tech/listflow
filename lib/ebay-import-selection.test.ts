import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQueuedEbayImportRequest,
  normalizeEbayImportSkuList,
  selectEbayListingsForImport,
  sortEbayListingSummariesForImport,
  type EbayListingSummary,
} from "@/lib/ebay-import-selection";

test("queued quantity imports preserve the request without accessing eBay", () => {
  assert.deepEqual(buildQueuedEbayImportRequest({ quantity: 12 }), {
    quantity: 12,
    requested: 12,
    total: 12,
    metadata: {
      mode: "QUANTITY",
      skuList: [],
      unmatchedSkus: [],
      matchedSkuCount: 0,
      selectedListingCount: 0,
      sortField: "START_DATE",
      sortDirection: "DESC",
    },
  });
});

test("queued SKU imports retain normalized SKUs for worker-time selection", () => {
  const request = buildQueuedEbayImportRequest({
    quantity: 1,
    skuList: "ABC\nabc\nXYZ",
    sortDirection: "ASC",
  });

  assert.equal(request.requested, 2);
  assert.equal(request.total, 2);
  assert.equal(request.metadata.mode, "SKU");
  assert.deepEqual(request.metadata.skuList, ["ABC", "XYZ"]);
  assert.equal(request.metadata.sortDirection, "ASC");
});

const listings: EbayListingSummary[] = [
  {
    itemId: "1003",
    skus: ["WHITE-SET", "VAR-GAS"],
    startTime: "2026-01-03T00:00:00.000Z",
  },
  {
    itemId: "1001",
    skus: ["ABC"],
    startTime: "2026-01-01T00:00:00.000Z",
  },
  {
    itemId: "1002",
    skus: ["abc-1", "VAR-ELECTRIC"],
    startTime: "2026-01-02T00:00:00.000Z",
  },
  {
    itemId: "1004",
    skus: ["NO-DATE"],
    startTime: null,
  },
];

test("normalizeEbayImportSkuList splits and dedupes case-insensitively", () => {
  assert.deepEqual(
    normalizeEbayImportSkuList(" ABC\nabc, DEF;\tghi \n"),
    ["ABC", "DEF", "ghi"],
  );
});

test("SKU import matches exact listing SKUs case-insensitively", () => {
  const selection = selectEbayListingsForImport({
    listingSummaries: listings,
    skuList: ["abc"],
    sortDirection: "DESC",
  });

  assert.deepEqual(selection.selectedListingIds, ["1001"]);
  assert.deepEqual(selection.metadata.unmatchedSkus, []);
});

test("SKU import does not match partial SKUs", () => {
  const selection = selectEbayListingsForImport({
    listingSummaries: listings,
    skuList: ["AB"],
  });

  assert.deepEqual(selection.selectedListingIds, []);
  assert.deepEqual(selection.metadata.unmatchedSkus, ["AB"]);
});

test("SKU import matches variation SKUs and dedupes selected listings", () => {
  const selection = selectEbayListingsForImport({
    listingSummaries: listings,
    skuList: ["VAR-GAS", "white-set", "VAR-GAS"],
    sortDirection: "DESC",
  });

  assert.deepEqual(selection.selectedListingIds, ["1003"]);
  assert.equal(selection.metadata.matchedSkuCount, 2);
});

test("SKU import omits already imported listings", () => {
  const selection = selectEbayListingsForImport({
    listingSummaries: listings,
    existingListingIds: ["1003"],
    skuList: ["VAR-GAS", "ABC"],
    sortDirection: "ASC",
  });

  assert.deepEqual(selection.selectedListingIds, ["1001"]);
  assert.deepEqual(selection.metadata.unmatchedSkus, ["VAR-GAS"]);
});

test("quantity import orders by start date before slicing", () => {
  const newest = selectEbayListingsForImport({
    listingSummaries: listings,
    quantity: 2,
    sortDirection: "DESC",
  });
  const oldest = selectEbayListingsForImport({
    listingSummaries: listings,
    quantity: 2,
    sortDirection: "ASC",
  });

  assert.deepEqual(newest.selectedListingIds, ["1003", "1002"]);
  assert.deepEqual(oldest.selectedListingIds, ["1001", "1002"]);
});

test("start date sorting puts missing dates last with item ID tie-breaker", () => {
  const sorted = sortEbayListingSummariesForImport(
    [
      { itemId: "2002", skus: [], startTime: null },
      { itemId: "2001", skus: [], startTime: null },
      { itemId: "1002", skus: [], startTime: "2026-01-01T00:00:00.000Z" },
      { itemId: "1001", skus: [], startTime: "2026-01-01T00:00:00.000Z" },
    ],
    "DESC",
  );

  assert.deepEqual(
    sorted.map((summary) => summary.itemId),
    ["1001", "1002", "2001", "2002"],
  );
});
