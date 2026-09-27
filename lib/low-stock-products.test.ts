import assert from "node:assert/strict";
import test from "node:test";
import { ProductStatus } from "../app/generated/prisma/enums";
import {
  getLowStockResolvedUpdate,
  getLowStockProductWhere,
  getMinimumProductQuantity,
  isAmazonStockLow,
  isLowStockHoldJobMetadata,
  isAmazonStockHealthy,
  isResolvedLowStockHoldReason,
  LOW_STOCK_HOLD_JOB_KIND,
  LOW_STOCK_RESOLVED_HOLD_REASON,
} from "./low-stock-products";

test("store minimum is a positive integer with a default of two", () => {
  assert.equal(getMinimumProductQuantity(undefined), 2);
  assert.equal(getMinimumProductQuantity(3), 3);
  assert.equal(getMinimumProductQuantity(0), 2);
  assert.equal(getMinimumProductQuantity(2.5), 2);
});

test("stock below the configured minimum is held and equal stock is sufficient", () => {
  for (const minimum of [1, 2, 3]) {
    assert.equal(isAmazonStockLow(minimum - 1, minimum), true);
    assert.equal(isAmazonStockLow(minimum, minimum), false);
    assert.equal(isAmazonStockHealthy(minimum, minimum), true);
    assert.equal(isAmazonStockHealthy(minimum - 1, minimum), false);
    assert.deepEqual(getLowStockProductWhere("store-current", minimum), {
      storeId: "store-current",
      status: ProductStatus.IMPORTED,
      asin: { not: null },
      amazonStockLeft: { gte: 0, lt: minimum },
    });
  }
  assert.equal(isAmazonStockLow(null, 2), false);
  assert.equal(isAmazonStockLow(undefined, 2), false);
  assert.equal(isAmazonStockHealthy(undefined, 2), false);
});

test("low-stock bulk hold jobs have explicit metadata", () => {
  assert.equal(isLowStockHoldJobMetadata({ kind: LOW_STOCK_HOLD_JOB_KIND }), true);
  assert.equal(isLowStockHoldJobMetadata({ kind: "manual-hold" }), false);
  assert.equal(isLowStockHoldJobMetadata(null), false);
});

test("low-stock recovery requires a confirmed count at or above the current minimum", () => {
  const held = { status: ProductStatus.ON_HOLD, holdReason: "Low Amazon stock (1 left).", holdOrigin: "LOW_STOCK" };
  assert.deepEqual(getLowStockResolvedUpdate(held, 1, 2), {});
  assert.deepEqual(getLowStockResolvedUpdate(held, 2, 2), { holdReason: LOW_STOCK_RESOLVED_HOLD_REASON });
  assert.deepEqual(getLowStockResolvedUpdate(held, 2, 3), {});
  assert.deepEqual(getLowStockResolvedUpdate(held, null, 2), {});
  assert.deepEqual(getLowStockResolvedUpdate(held, undefined, 2), {});
  assert.deepEqual(getLowStockResolvedUpdate({ ...held, holdReason: "Put on hold manually." }, 5, 2), {});
  assert.deepEqual(getLowStockResolvedUpdate({ ...held, holdOrigin: "MANUAL" }, 5, 2), {});
  assert.deepEqual(getLowStockResolvedUpdate({ ...held, status: ProductStatus.IMPORTED }, 5, 2), {});
  assert.equal(isResolvedLowStockHoldReason(LOW_STOCK_RESOLVED_HOLD_REASON), true);
  assert.equal(isResolvedLowStockHoldReason("Put on hold manually."), false);
});
