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
    stockLeft: 4,
    observedAt: new Date("2026-01-01T00:01:00Z"),
  }],
  _count: { priceHistory: 0 },
  lastPriceCheck: new Date("2026-01-01T00:00:00Z"),
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

test("default restoration allows missing snapshots but never overrides manual holds", () => {
  const candidate = { ...heldProduct, ...getPriceCheckRecoveryEvidence(evidence) };
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, holdSavedQuantity: null }), true);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, holdOrigin: "MANUAL" }), false);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, holdOrigin: "UNKNOWN" }), false);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...candidate, status: "IMPORTED" }), false);
});

test("all eligible automatic hold types recover without requiring a saved quantity", () => {
  const candidate = { ...heldProduct, ...getPriceCheckRecoveryEvidence(evidence) };
  for (const holdSavedQuantity of [undefined, null, 0, 1, 5, 20]) {
    for (const amazonPriceTrackingMode of ["REGULAR", "DEAL"]) {
      for (const holdOrigin of ["PRICE_CHECK_OUT_OF_STOCK", "PRICE_CHECK_PRICE_UNAVAILABLE", "PRICE_CHECK_IDENTITY", "LOW_STOCK"]) {
        const product = { ...candidate, holdSavedQuantity, amazonPriceTrackingMode, holdOrigin, amazonStockLeft: 4 };
        assert.equal(isRecoveredPriceCheckAutoHold(product), true);
        assert.equal(isRecoveredPriceCheckAutoHold({ ...product, hasUnappliedPriceChange: true }), false);
        assert.equal(isRecoveredPriceCheckAutoHold({ ...product, postcodeVerified: false }), false);
        if (holdOrigin === "LOW_STOCK") {
          assert.equal(isRecoveredPriceCheckAutoHold({ ...product, amazonStockLeft: 1 }), false);
        }
      }
    }
  }
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
      ...getPriceCheckRecoveryEvidence({ ...evidence, amazonPriceObservations: [{ ...evidence.amazonPriceObservations[0], ...observation }] }),
    }), false);
  }
});

test("stale stock observations cannot release a low-stock hold", () => {
  const stale = getPriceCheckRecoveryEvidence({
    ...evidence,
    lastPriceCheck: new Date("2026-01-01T00:02:00Z"),
  });
  assert.equal(stale.verifiedStockLeft, null);
  assert.equal(stale.identityOutcome, null);
  assert.equal(isRecoveredPriceCheckAutoHold({ ...heldProduct, ...stale }), false);
  assert.equal(isRecoveredPriceCheckAutoHold({
    ...heldProduct, holdOrigin: "LOW_STOCK", amazonStockLeft: 4, ...stale,
  }), false);
});
