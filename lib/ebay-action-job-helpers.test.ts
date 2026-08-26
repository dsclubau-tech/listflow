import assert from "node:assert/strict";
import test from "node:test";
import { ProductStatus } from "@/app/generated/prisma/enums";
import {
  chunkInventoryReviseItems,
  getBulkEditQuantityStatus,
  getReviseListingQuantityOptions,
  isReviseListingQuantityChanged,
  shouldRetryInventoryBatchIndividually,
} from "@/lib/ebay-action-job-helpers";

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `product-${index + 1}`);
}

test("chunkInventoryReviseItems keeps one item in one batch", () => {
  assert.deepEqual(chunkInventoryReviseItems(ids(1)), [["product-1"]]);
});

test("chunkInventoryReviseItems keeps four items in one eBay batch", () => {
  assert.deepEqual(chunkInventoryReviseItems(ids(4)), [
    ["product-1", "product-2", "product-3", "product-4"],
  ]);
});

test("chunkInventoryReviseItems splits five items into four plus one", () => {
  assert.deepEqual(chunkInventoryReviseItems(ids(5)), [
    ["product-1", "product-2", "product-3", "product-4"],
    ["product-5"],
  ]);
});

test("chunkInventoryReviseItems splits nine items into three eBay batches", () => {
  assert.deepEqual(chunkInventoryReviseItems(ids(9)), [
    ["product-1", "product-2", "product-3", "product-4"],
    ["product-5", "product-6", "product-7", "product-8"],
    ["product-9"],
  ]);
});

test("shouldRetryInventoryBatchIndividually retries failed multi-item batches only", () => {
  assert.equal(
    shouldRetryInventoryBatchIndividually({ success: false, itemCount: 4 }),
    true,
  );
  assert.equal(
    shouldRetryInventoryBatchIndividually({ success: false, itemCount: 1 }),
    false,
  );
  assert.equal(
    shouldRetryInventoryBatchIndividually({ success: true, itemCount: 4 }),
    false,
  );
});

test("getBulkEditQuantityStatus aligns successful quantity edits with listing state", () => {
  assert.equal(
    getBulkEditQuantityStatus({
      quantityChanged: true,
      quantity: 0,
      currentStatus: ProductStatus.IMPORTED,
    }),
    ProductStatus.ON_HOLD,
  );
  assert.equal(
    getBulkEditQuantityStatus({
      quantityChanged: true,
      quantity: 5,
      currentStatus: ProductStatus.ON_HOLD,
    }),
    ProductStatus.IMPORTED,
  );
  assert.equal(
    getBulkEditQuantityStatus({
      quantityChanged: false,
      quantity: 0,
      currentStatus: ProductStatus.IMPORTED,
    }),
    ProductStatus.IMPORTED,
  );
});

test("single-listing revision metadata only enables explicit quantity edits", () => {
  assert.equal(isReviseListingQuantityChanged(null), false);
  assert.equal(isReviseListingQuantityChanged({ quantityChanged: false }), false);
  assert.equal(isReviseListingQuantityChanged({ quantityChanged: "true" }), false);
  assert.equal(isReviseListingQuantityChanged({ quantityChanged: true }), true);
});

test("single-listing policy revisions omit quantity while explicit holds send zero", () => {
  assert.deepEqual(
    getReviseListingQuantityOptions({ quantityChanged: false, quantity: 0 }),
    { includeQuantity: false, quantityOverride: undefined },
  );
  assert.deepEqual(
    getReviseListingQuantityOptions({ quantityChanged: true, quantity: 0 }),
    { includeQuantity: true, quantityOverride: 0 },
  );
});
