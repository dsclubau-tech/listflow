import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_IMPORT_MAX_ATTEMPTS,
  getAmazonImportRetryPlan,
  isAmazonImportPeerRetry,
  resolveAmazonImportRetryTarget,
} from "./amazon-import-job-policy";

test("a failed specialist import gets one unified-worker retry", () => {
  assert.deepEqual(
    getAmazonImportRetryPlan({
      workerRole: "store-specific",
      attempts: 1,
    }),
    {
      target: "unified",
      requiredWorkerRole: "unified",
      stage: "RETRYING_ON_UNIFIED_WORKER",
    },
  );
  assert.equal(AMAZON_IMPORT_MAX_ATTEMPTS, 2);
});

test("peer mode sends the retry to a different store-specific worker", () => {
  assert.deepEqual(
    getAmazonImportRetryPlan({
      workerRole: "store-specific",
      attempts: 1,
      target: "peer",
    }),
    {
      target: "peer",
      requiredWorkerRole: "store-specific",
      stage: "RETRYING_ON_PEER_WORKER",
    },
  );
  assert.equal(
    isAmazonImportPeerRetry({
      stage: "RETRYING_ON_PEER_WORKER",
      workerId: "local-store-1-a",
    }),
    true,
  );
});

test("unified and exhausted imports do not loop", () => {
  assert.equal(
    getAmazonImportRetryPlan({
      workerRole: "unified",
      attempts: 1,
    }),
    null,
  );
  assert.equal(
    getAmazonImportRetryPlan({
      workerRole: "store-specific",
      attempts: AMAZON_IMPORT_MAX_ATTEMPTS,
      target: "peer",
    }),
    null,
  );
});

test("retry target validation defaults to unified and rejects typos", () => {
  assert.equal(resolveAmazonImportRetryTarget(undefined), "unified");
  assert.equal(resolveAmazonImportRetryTarget(" peer "), "peer");
  assert.throws(
    () => resolveAmazonImportRetryTarget("another"),
    /must be unified or peer/,
  );
});
