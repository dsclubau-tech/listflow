import assert from "node:assert/strict";
import test from "node:test";
import {
  canAutomaticallyApplyTrackedPriceChange,
  shouldAutomaticallyApplyPriceDecrease,
  shouldAutomaticallyApplyPriceIncrease,
} from "./price-change-automation";

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

test("automatically applies a safe absolute supplier price decrease", () => {
  assert.equal(shouldAutomaticallyApplyPriceDecrease(398, 397), true);
  assert.equal(shouldAutomaticallyApplyPriceDecrease(398, 398), false);
  assert.equal(shouldAutomaticallyApplyPriceDecrease(398, Number.NaN), false);
});

test("does not auto-apply when a promoted-ad cost is dynamic", () => {
  assert.equal(
    canAutomaticallyApplyTrackedPriceChange({ promotedAdStatus: "PROMOTED", promotedAdRateStrategy: "DYNAMIC" }),
    false,
  );
  assert.equal(
    canAutomaticallyApplyTrackedPriceChange({ promotedAdStatus: "PROMOTED", promotedAdRateStrategy: "FIXED" }),
    true,
  );
});
