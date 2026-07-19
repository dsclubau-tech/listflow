import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAbsolutePriceChanges,
  getPriceChangeDirection,
} from "@/lib/price-history-view";

test("price history direction uses the signed currency amount", () => {
  assert.equal(getPriceChangeDirection("12.50"), "up");
  assert.equal(getPriceChangeDirection("-0.01"), "down");
  assert.equal(getPriceChangeDirection("0.00"), "unchanged");
});

test("price history change sorting uses absolute currency amounts", () => {
  const values = ["-2.00", "15.00", "5.00"];

  assert.deepEqual(
    [...values].sort((left, right) =>
      compareAbsolutePriceChanges(left, right, "largest"),
    ),
    ["15.00", "5.00", "-2.00"],
  );
  assert.deepEqual(
    [...values].sort((left, right) =>
      compareAbsolutePriceChanges(left, right, "smallest"),
    ),
    ["-2.00", "5.00", "15.00"],
  );
});
