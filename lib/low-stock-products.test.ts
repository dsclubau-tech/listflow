import assert from "node:assert/strict";
import test from "node:test";
import { ProductStatus } from "../app/generated/prisma/enums";
import {
  getLowStockResolvedUpdate,
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

test("getLowStockResolvedUpdate resolves holdReason when stock is healthy", () => {
  // Case 1: ON_HOLD with Low Amazon stock, scraped stock is null (In stock) -> resolved
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.ON_HOLD, holdReason: "Low Amazon stock (2 left)." },
      null
    ),
    { holdReason: "Low Amazon stock resolved — product is back in stock on Amazon." }
  );

  // Case 2: ON_HOLD with Low Amazon stock, scraped stock is > LOW_STOCK_THRESHOLD (e.g., 5) -> resolved
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.ON_HOLD, holdReason: "Low Amazon stock (1 left)." },
      5
    ),
    { holdReason: "Low Amazon stock resolved — product is back in stock on Amazon." }
  );

  // Case 3: ON_HOLD with Low Amazon stock, scraped stock is still <= LOW_STOCK_THRESHOLD -> no change
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.ON_HOLD, holdReason: "Low Amazon stock (2 left)." },
      2
    ),
    {}
  );

  // Case 4: ON_HOLD with non-stock holdReason (e.g. manual hold) -> no change
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.ON_HOLD, holdReason: "Put on hold manually." },
      null
    ),
    {}
  );

  // Case 5: Product is IMPORTED (not ON_HOLD) -> no change
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.IMPORTED, holdReason: "Low Amazon stock (2 left)." },
      null
    ),
    {}
  );

  // Case 6: stockLeft is undefined (not scraped / simulated) -> no change
  assert.deepEqual(
    getLowStockResolvedUpdate(
      { status: ProductStatus.ON_HOLD, holdReason: "Low Amazon stock (2 left)." },
      undefined
    ),
    {}
  );
});
