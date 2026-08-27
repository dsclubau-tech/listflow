import assert from "node:assert/strict";
import test from "node:test";
import {
  getEbayActionQueuePositionText,
  getEbayActionQueuePositions,
  getEbayActionJobLabel,
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

test("automatic price-check holds have a distinct action label", () => {
  assert.equal(
    getEbayActionJobLabel({
      type: "HOLD",
      metadata: { kind: "price-check-auto-hold" },
    }),
    "Auto hold after failed price check",
  );
  assert.equal(
    getEbayActionJobLabel({ type: "HOLD", metadata: {} }),
    "Put listings on hold",
  );
});

test("automatic recovered price checks have a distinct resume label", () => {
  assert.equal(
    getEbayActionJobLabel({
      type: "RESUME",
      metadata: { kind: "price-check-auto-resume" },
    }),
    "Auto resume after recovered price check",
  );
  assert.equal(
    getEbayActionJobLabel({ type: "RESUME", metadata: {} }),
    "Resume listings",
  );
});
