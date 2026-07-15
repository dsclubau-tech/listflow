import assert from "node:assert/strict";
import test from "node:test";
import {
  getEbayActionQueuePositionText,
  getEbayActionQueuePositions,
  getEbayActionStatusLabel,
} from "@/lib/ebay-action-queue";

test("getEbayActionQueuePositions orders active eBay actions FIFO", () => {
  const positions = getEbayActionQueuePositions([
    {
      id: "resume-second",
      status: "QUEUED",
      createdAt: "2026-07-14T10:00:02.000Z",
    },
    {
      id: "completed-hidden",
      status: "COMPLETED",
      createdAt: "2026-07-14T09:59:00.000Z",
    },
    {
      id: "hold-first",
      status: "RUNNING",
      createdAt: "2026-07-14T10:00:01.000Z",
    },
  ]);

  assert.equal(positions.get("hold-first"), 1);
  assert.equal(positions.get("resume-second"), 2);
  assert.equal(positions.has("completed-hidden"), false);
});

test("getEbayActionStatusLabel shows queued actions as waiting, not failed", () => {
  assert.equal(
    getEbayActionStatusLabel({ status: "QUEUED", queuePosition: 2 }),
    "Queued - waiting for earlier eBay action",
  );
  assert.equal(
    getEbayActionStatusLabel({ status: "RUNNING", queuePosition: 1 }),
    "Running",
  );
  assert.equal(
    getEbayActionStatusLabel({ status: "FAILED", queuePosition: null }),
    "FAILED",
  );
});

test("getEbayActionQueuePositionText only describes active eBay actions", () => {
  assert.equal(
    getEbayActionQueuePositionText({ status: "QUEUED", queuePosition: 2 }),
    "Queue position 2",
  );
  assert.equal(
    getEbayActionQueuePositionText({ status: "COMPLETED", queuePosition: null }),
    null,
  );
});
