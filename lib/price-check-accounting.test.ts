import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCompletedPriceCheckCount,
  uniqueCompletedProductIds,
} from "./price-check-accounting";

test("completed IDs are authoritative, unique, and retain job order", () => {
  assert.deepEqual(
    uniqueCompletedProductIds(
      ["p1", "p2", "p3"],
      ["p2", "p2", "not-in-job", "p1"],
    ),
    ["p1", "p2"],
  );
});

test("completed count cannot exceed total or drop below zero", () => {
  assert.equal(clampCompletedPriceCheckCount(332, 331), 331);
  assert.equal(clampCompletedPriceCheckCount(-1, 331), 0);
  assert.equal(clampCompletedPriceCheckCount(5.8, 10), 5);
});
