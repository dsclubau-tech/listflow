import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_IMPORT_MAX_ATTEMPTS,
  shouldRetryAmazonImportOnUnifiedWorker,
} from "./amazon-import-job-policy";

test("a failed specialist import gets one unified-worker retry", () => {
  assert.equal(
    shouldRetryAmazonImportOnUnifiedWorker({
      workerRole: "store-specific",
      attempts: 1,
    }),
    true,
  );
  assert.equal(AMAZON_IMPORT_MAX_ATTEMPTS, 2);
});

test("unified and exhausted imports do not loop", () => {
  assert.equal(
    shouldRetryAmazonImportOnUnifiedWorker({
      workerRole: "unified",
      attempts: 1,
    }),
    false,
  );
  assert.equal(
    shouldRetryAmazonImportOnUnifiedWorker({
      workerRole: "store-specific",
      attempts: AMAZON_IMPORT_MAX_ATTEMPTS,
    }),
    false,
  );
});
