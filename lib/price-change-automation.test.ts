import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutomaticallyApplyPriceIncrease } from "./price-change-automation";

test("automatically applies an Amazon buy-price increase", () => {
  assert.equal(shouldAutomaticallyApplyPriceIncrease(397, 398), true);
  assert.equal(shouldAutomaticallyApplyPriceIncrease(10, 10.01), true);
});

test("keeps unchanged and decreased prices in the normal workflow", () => {
  assert.equal(shouldAutomaticallyApplyPriceIncrease(398, 398), false);
  assert.equal(shouldAutomaticallyApplyPriceIncrease(398, 397), false);
});

test("does not auto-apply invalid prices", () => {
  assert.equal(shouldAutomaticallyApplyPriceIncrease(Number.NaN, 398), false);
  assert.equal(shouldAutomaticallyApplyPriceIncrease(397, Number.POSITIVE_INFINITY), false);
});
