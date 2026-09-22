import assert from "node:assert/strict";
import test from "node:test";
import { PriceCheckFailureCode, ProductHoldOrigin } from "../app/generated/prisma/enums";
import {
  canAutomaticallyRecoverHold,
  captureHoldQuantities,
  getProductHoldOrigin,
} from "./product-hold-state";

test("hold origin is derived from the failure, not the rendered reason", () => {
  assert.equal(
    getProductHoldOrigin({ automaticPriceCheck: true, failureCode: PriceCheckFailureCode.AMAZON_OUT_OF_STOCK }),
    ProductHoldOrigin.PRICE_CHECK_OUT_OF_STOCK,
  );
  assert.equal(
    getProductHoldOrigin({ automaticPriceCheck: true, failureCode: PriceCheckFailureCode.AMAZON_ASIN_REDIRECT }),
    ProductHoldOrigin.PRICE_CHECK_IDENTITY,
  );
  assert.equal(getProductHoldOrigin({}), ProductHoldOrigin.MANUAL);
});

test("hold snapshots preserve the pre-hold quantity across repeated holds", () => {
  const first = captureHoldQuantities({
    currentQuantity: 5,
    variants: [{ id: "v1", sku: "SKU-1", quantity: 5 }],
  });
  const repeated = captureHoldQuantities({
    currentQuantity: 0,
    existingSavedQuantity: first.savedQuantity,
    existingSavedVariants: first.savedVariants,
    variants: [{ id: "v1", sku: "SKU-1", quantity: 0 }],
  });
  assert.equal(repeated.savedQuantity, 5);
  assert.equal(repeated.savedVariants[0].quantity, 5);
});

test("automatic recovery requires affirmative availability and low-stock evidence", () => {
  const base = {
    origin: ProductHoldOrigin.PRICE_CHECK_OUT_OF_STOCK,
    hasVerifiedPrice: true,
    savedQuantity: 5,
    identityVerified: true,
  } as const;
  assert.equal(canAutomaticallyRecoverHold({ ...base, availability: "UNKNOWN" }), false);
  assert.equal(canAutomaticallyRecoverHold({ ...base, availability: "IN_STOCK" }), true);
  assert.equal(
    canAutomaticallyRecoverHold({
      ...base,
      origin: ProductHoldOrigin.LOW_STOCK,
      availability: "IN_STOCK",
      stockLeft: 3,
    }),
    false,
  );
  assert.equal(
    canAutomaticallyRecoverHold({
      ...base,
      origin: ProductHoldOrigin.LOW_STOCK,
      availability: "IN_STOCK",
      stockLeft: 4,
    }),
    true,
  );
});
