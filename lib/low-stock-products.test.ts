import assert from "node:assert/strict";
import test from "node:test";
import { ProductStatus } from "../app/generated/prisma/enums";
import {
  getLowStockProductWhere,
  isLowStockHoldJobMetadata,
  LOW_STOCK_HOLD_JOB_KIND,
  LOW_STOCK_THRESHOLD,
} from "./low-stock-products";

test("low-stock actions are scoped to imported products in the current store", () => {
  assert.deepEqual(getLowStockProductWhere("store-current"), {
    storeId: "store-current",
    status: ProductStatus.IMPORTED,
    asin: { not: null },
    amazonStockLeft: { not: null, lte: LOW_STOCK_THRESHOLD },
  });
  assert.equal(LOW_STOCK_THRESHOLD, 3);
});

test("low-stock bulk hold jobs have explicit metadata", () => {
  assert.equal(
    isLowStockHoldJobMetadata({ kind: LOW_STOCK_HOLD_JOB_KIND }),
    true
  );
  assert.equal(isLowStockHoldJobMetadata({ kind: "manual-hold" }), false);
  assert.equal(isLowStockHoldJobMetadata(null), false);
});
