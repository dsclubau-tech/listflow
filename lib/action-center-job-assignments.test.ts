import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveJobAssignmentIndex,
  getActiveJobAssignment,
} from "./action-center-job-assignments";

test("active job assignments deduplicate resource leases for one job", () => {
  const assignments = buildActiveJobAssignmentIndex([
    {
      workerId: "worker-oz",
      workerName: "Oz Metro Worker",
      workerRole: "store-specific",
      currentJobs: [
        {
          jobType: "PRICE_CHECK",
          jobId: "price-1",
          workerId: "worker-oz",
          workerName: "Oz Metro Worker",
          renewedAt: "2026-08-25T10:00:00.000Z",
        },
        {
          jobType: "PRICE_CHECK",
          jobId: "price-1",
          workerId: "worker-oz",
          workerName: "Oz Metro Worker",
          renewedAt: "2026-08-25T10:00:05.000Z",
        },
      ],
    },
  ]);

  assert.equal(assignments.size, 1);
  assert.deepEqual(getActiveJobAssignment(assignments, "PRICE_CHECK", "price-1"), {
    jobType: "PRICE_CHECK",
    jobId: "price-1",
    workerId: "worker-oz",
    workerName: "Oz Metro Worker",
    workerRole: "store-specific",
    renewedAt: "2026-08-25T10:00:05.000Z",
  });
});

test("assignment index distinguishes job types and research jobs", () => {
  const assignments = buildActiveJobAssignmentIndex([
    {
      workerId: "worker-all",
      workerName: "All Stores Unified Worker",
      workerRole: "unified",
      currentJobs: [
        {
          jobType: "EBAY_IMPORT",
          jobId: "shared-id",
          workerId: "worker-all",
          workerName: "All Stores Unified Worker",
          renewedAt: "2026-08-25T10:00:00.000Z",
        },
        {
          jobType: "EBAY_RESEARCH",
          jobId: "research-1",
          workerId: "worker-all",
          workerName: "All Stores Unified Worker",
          renewedAt: "2026-08-25T10:00:00.000Z",
        },
      ],
    },
  ]);

  assert.equal(
    getActiveJobAssignment(assignments, "EBAY_IMPORT", "shared-id")?.workerName,
    "All Stores Unified Worker",
  );
  assert.equal(
    getActiveJobAssignment(assignments, "EBAY_RESEARCH", "research-1")?.workerId,
    "worker-all",
  );
  assert.equal(getActiveJobAssignment(assignments, "EBAY_ACTION", "shared-id"), null);
});
