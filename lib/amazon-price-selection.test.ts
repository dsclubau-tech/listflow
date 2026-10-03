import assert from "node:assert/strict";
import test from "node:test";
import { getAmazonPriceSelection } from "./amazon-price-selection";

const observedAt = new Date("2026-10-03T00:00:00Z");
const product = {
  asin: "B0TEST1234", amazonPriceTrackingMode: "DEAL", amazonPrice: "749.00",
  lastPriceCheck: observedAt, holdLastObservationId: "accepted",
  priceCheckError: null, priceCheckFailureCode: null,
};
const observation = {
  id: "accepted", requestedAsin: product.asin, selectedAsin: product.asin,
  identityOutcome: "MATCH", buyBoxOutcome: "AVAILABLE", postcodeVerified: true,
  isSuccessful: true, eligibleOffer: true, priceMode: "REGULAR",
  price: "749.00", regularPrice: "749.00", dealPrice: null, observedAt,
};

test("fallback display preserves the saved Deal preference and follows its committed observation", () => {
  assert.deepEqual(getAmazonPriceSelection(product, observation), {
    requestedMode: "DEAL", effectiveMode: "REGULAR", isFallback: true, observedAt: observedAt.toISOString(),
  });
  assert.equal(getAmazonPriceSelection({ ...product, amazonPriceTrackingMode: "REGULAR" }, observation)?.isFallback, false);
  assert.equal(getAmazonPriceSelection({ ...product, amazonPrice: 429 }, {
    ...observation, priceMode: "DEAL", price: "429", dealPrice: "429",
  })?.isFallback, false);
});

test("uncommitted, stale, failed, and unverified observations never display fallback", () => {
  for (const patch of [
    { id: "uncommitted" }, { observedAt: new Date(observedAt.getTime() - 1) },
    { observedAt: new Date(observedAt.getTime() + 1) }, { isSuccessful: false },
    { eligibleOffer: false }, { postcodeVerified: false }, { identityOutcome: "UNKNOWN" },
    { buyBoxOutcome: "UNAVAILABLE" }, { requestedAsin: "B0OTHER123" }, { selectedAsin: "B0OTHER123" },
    { priceMode: null }, { price: null }, { price: "0" }, { price: "Infinity" },
    { regularPrice: "700" }, { dealPrice: "429" },
  ]) assert.equal(getAmazonPriceSelection(product, { ...observation, ...patch }), null, JSON.stringify(patch));
  assert.equal(getAmazonPriceSelection(product, undefined), null);
  assert.equal(getAmazonPriceSelection({ ...product, priceCheckError: "Check failed" }, observation), null);
  assert.equal(getAmazonPriceSelection({ ...product, priceCheckFailureCode: "TECHNICAL_ERROR" }, observation), null);
  assert.equal(getAmazonPriceSelection({ ...product, amazonPrice: 429 }, observation), null);
  assert.equal(getAmazonPriceSelection({ ...product, lastPriceCheck: null }, observation), null);
});

test("Regular preference cannot display a separate deal as its selected price", () => {
  assert.equal(getAmazonPriceSelection({ ...product, amazonPriceTrackingMode: "REGULAR", amazonPrice: 429 }, {
    ...observation, priceMode: "DEAL", price: "429", dealPrice: "429",
  }), null);
});
