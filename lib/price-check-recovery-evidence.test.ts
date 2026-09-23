import assert from "node:assert/strict";
import test from "node:test";
import { isRecoveredPriceCheckAutoHold } from "./price-check-failures";
import { getPriceCheckRecoveryEvidence } from "./price-check-recovery-evidence";

const heldProduct = {
  id: "held-product",
  status: "ON_HOLD",
  ebayItemId: "123",
  amazonPriceTrackingMode: "REGULAR",
  amazonPrice: 62.88,
  amazonAvailability: "IN_STOCK",
  holdOrigin: "PRICE_CHECK_OUT_OF_STOCK",
  holdReason: "Original stock failure",
  holdSavedQuantity: 5,
  priceCheckError: null,
  priceCheckFailureCode: null,
};

const evidence = {
  amazonPriceObservations: [{
    identityOutcome: "MATCH",
    buyBoxOutcome: "AVAILABLE",
    postcodeVerified: true,
  }],
  _count: { priceHistory: 0 },
};

test("the resume worker needs observation evidence as well as the product row", () => {
  assert.equal(isRecoveredPriceCheckAutoHold(heldProduct), false);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...heldProduct, ...getPriceCheckRecoveryEvidence(evidence) }), true);
});

test("pending or failed price updates block restoration until confirmed", () => {
  const candidate = {
    ...heldProduct,
    ...getPriceCheckRecoveryEvidence({ ...evidence, _count: { priceHistory: 1 } }),
  };
  assert.equal(isRecoveredPriceCheckAutoHold(candidate), false);
});

test("recovered availability never guesses missing quantities or overrides manual holds", () => {
  const candidate = { ...heldProduct, ...getPriceCheckRecoveryEvidence(evidence) };
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, holdSavedQuantity: null }), false);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, holdOrigin: "MANUAL" }), false);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, status: "IMPORTED" }), false);
});

test("missing or inconclusive observations cannot restore stock", () => {
  assert.equal(isRecoveredPriceCheckAutoHold({
    ...heldProduct,
    ...getPriceCheckRecoveryEvidence({ ...evidence, amazonPriceObservations: [] }),
  }), false);
  for (const observation of [
    { identityOutcome: "MISMATCH", buyBoxOutcome: "AVAILABLE", postcodeVerified: true },
    { identityOutcome: "MATCH", buyBoxOutcome: "UNAVAILABLE", postcodeVerified: true },
    { identityOutcome: "MATCH", buyBoxOutcome: "AVAILABLE", postcodeVerified: false },
  ]) {
    assert.equal(isRecoveredPriceCheckAutoHold({
      ...heldProduct,
      ...getPriceCheckRecoveryEvidence({ ...evidence, amazonPriceObservations: [observation] }),
    }), false);
  }
});
