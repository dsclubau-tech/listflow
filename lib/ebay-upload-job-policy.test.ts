import assert from "node:assert/strict";
import test from "node:test";
import { partitionUploadProductIds } from "./ebay-upload-job-policy";

test("repeated upload requests reuse active products instead of queueing them again", () => {
  assert.deepEqual(
    partitionUploadProductIds({
      requestedProductIds: ["product-1"],
      alreadyListedProductIds: [],
      activeJobs: [{ id: "job-1", productIds: ["product-1"] }],
    }),
    { activeProductIds: ["product-1"], queueProductIds: [] },
  );
});

test("overlapping batch requests queue only products without active uploads", () => {
  assert.deepEqual(
    partitionUploadProductIds({
      requestedProductIds: ["product-1", "product-2", "product-3"],
      alreadyListedProductIds: ["product-1"],
      activeJobs: [{ id: "job-1", productIds: ["product-2"] }],
    }),
    { activeProductIds: ["product-2"], queueProductIds: ["product-3"] },
  );
});
