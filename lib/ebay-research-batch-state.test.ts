import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayResearchBatchStatus,
  EbayResearchJobStatus,
} from "../app/generated/prisma/enums";
import {
  getResumedEbayResearchBatchStatus,
  isEbayResearchBatchResumable,
} from "./ebay-research-batch-state";

test("research batches can resume while paused or still pausing", () => {
  assert.equal(isEbayResearchBatchResumable(EbayResearchBatchStatus.PAUSED), true);
  assert.equal(isEbayResearchBatchResumable(EbayResearchBatchStatus.PAUSING), true);
  assert.equal(isEbayResearchBatchResumable(EbayResearchBatchStatus.RUNNING), false);
  assert.equal(isEbayResearchBatchResumable(EbayResearchBatchStatus.COMPLETED), false);
});

test("resuming a pausing batch keeps its active search running", () => {
  assert.equal(
    getResumedEbayResearchBatchStatus([
      EbayResearchJobStatus.COMPLETED,
      EbayResearchJobStatus.PAUSING,
      EbayResearchJobStatus.PAUSED,
    ]),
    EbayResearchBatchStatus.RUNNING
  );
  assert.equal(
    getResumedEbayResearchBatchStatus([
      EbayResearchJobStatus.COMPLETED,
      EbayResearchJobStatus.PAUSED,
    ]),
    EbayResearchBatchStatus.QUEUED
  );
});
