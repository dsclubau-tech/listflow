import assert from "node:assert/strict";
import test from "node:test";
import { PriceCheckFailureCode, ProductHoldOrigin } from "../app/generated/prisma/enums";
import {
  canAutomaticallyRecoverHold,
  captureHoldQuantities,
  getProductHoldOrigin,
  getHeldProductTrackingState,
} from "./product-hold-state";

test("legacy automatic holds can await recovery to quantity one without a snapshot", () => {
  const state = getHeldProductTrackingState({
    status: "ON_HOLD",
    holdOrigin: "PRICE_CHECK_PRICE_UNAVAILABLE",
    holdSavedQuantity: null,
  });
  assert.equal(state?.label, "Awaiting recovery");
  assert.match(state?.detail ?? "", /quantity 1/);
  assert.equal(getHeldProductTrackingState({ status: "IMPORTED" }), null);
});

test("manual holds stay explicit even without a quantity snapshot", () => {
  const state = getHeldProductTrackingState({ status: "ON_HOLD", holdOrigin: "MANUAL" });
  assert.equal(state?.label, "Held manually");
});

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
  assert.equal(getProductHoldOrigin({ existing: ProductHoldOrigin.PRICE_CHECK_OUT_OF_STOCK }), ProductHoldOrigin.MANUAL);
  assert.equal(getProductHoldOrigin({
    automaticPriceCheck: true,
    existing: ProductHoldOrigin.MANUAL,
    failureCode: PriceCheckFailureCode.AMAZON_OUT_OF_STOCK,
  }), ProductHoldOrigin.MANUAL);
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

test("restore eligibility does not depend on the previous quantity", () => {
  for (const savedQuantity of [undefined, null, 0, 1, 5, 20]) {
    const candidate = {
      origin: ProductHoldOrigin.PRICE_CHECK_OUT_OF_STOCK,
      availability: "IN_STOCK" as const,
      hasVerifiedPrice: true,
      identityVerified: true,
      savedQuantity,
    };
    assert.equal(canAutomaticallyRecoverHold(candidate), true);
    for (const origin of [ProductHoldOrigin.MANUAL, ProductHoldOrigin.UNKNOWN]) {
      assert.equal(canAutomaticallyRecoverHold({ ...candidate, origin }), false);
    }
  }
});
