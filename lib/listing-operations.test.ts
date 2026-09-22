import assert from "node:assert/strict";
import test from "node:test";
import { getListingOperationRequestKey } from "./listing-operation-key";

test("listing operation keys are stable per job and product", () => {
  assert.equal(getListingOperationRequestKey("job-1", "product-1"), "job-1:product-1");
  assert.notEqual(getListingOperationRequestKey("job-1", "product-1"), getListingOperationRequestKey("job-2", "product-1"));
});
