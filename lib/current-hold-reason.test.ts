import assert from "node:assert/strict";
import test from "node:test";
import { resolveCurrentHoldReason, type CurrentHoldReasonInput } from "@/lib/current-hold-reason";

const checkedAt = "2026-09-28T12:00:00.000Z";
const base: CurrentHoldReasonInput = {
  status: "ON_HOLD",
  holdOrigin: "PRICE_CHECK_PRICE_UNAVAILABLE",
  holdReason: "Regular price is no longer available.",
  priceCheckError: "Regular price is no longer available.",
  priceCheckFailureCode: "AMAZON_PRICE_UNAVAILABLE",
  lastPriceCheck: checkedAt,
  savedQuantity: 1,
  minimumProductQuantity: 2,
  asin: "B0H1B1YF8F",
};

test("automatic holds follow the latest failed check, stock and recovery", () => {
  const first = resolveCurrentHoldReason(base);
  assert.match(first.currentHoldReason ?? "", /Regular price is no longer available/);
  assert.equal(first.latestCheckAt, checkedAt);

  const redirected = resolveCurrentHoldReason({
    ...base,
    priceCheckError: "Amazon redirected ASIN B0H1B1YF8F to B0FRZXD6M5 — the original variant appears unavailable.",
    priceCheckFailureCode: "AMAZON_ASIN_REDIRECT",
  });
  assert.match(redirected.currentHoldReason ?? "", /B0H1B1YF8F to B0FRZXD6M5/);
  assert.equal(base.holdReason, "Regular price is no longer available.");

  const latestObservation = {
    requestedAsin: base.asin,
    identityOutcome: "MATCH",
    stockLeft: 1,
    observedAt: "2026-09-28T12:00:01.000Z",
  };
  const lowStock = resolveCurrentHoldReason({
    ...base,
    holdOrigin: "LOW_STOCK",
    priceCheckError: null,
    priceCheckFailureCode: null,
    latestObservation,
  });
  assert.equal(lowStock.currentHoldReason, "Low Amazon stock (1 left; minimum 2).");

  const recovered = resolveCurrentHoldReason({
    ...base,
    holdOrigin: "LOW_STOCK",
    priceCheckError: null,
    priceCheckFailureCode: null,
    latestObservation: { ...latestObservation, stockLeft: 3 },
  });
  assert.match(recovered.currentHoldReason ?? "", /restoration on eBay is pending/);
});

test("technical failure and unknown stock retain automatic holds", () => {
  const technical = resolveCurrentHoldReason({
    ...base,
    priceCheckError: "Browser timed out.",
    priceCheckFailureCode: "TECHNICAL_ERROR",
  });
  assert.match(technical.currentHoldReason ?? "", /could not verify Amazon: Browser timed out/);
  const staleStock = resolveCurrentHoldReason({
    ...base,
    holdOrigin: "LOW_STOCK",
    priceCheckError: null,
    latestObservation: {
      requestedAsin: base.asin,
      identityOutcome: "MATCH",
      stockLeft: 1,
      observedAt: "2026-09-28T11:59:00.000Z",
    },
  });
  assert.match(staleStock.currentHoldReason ?? "", /could not be verified/);
});

test("pending reviews and manual holds preserve their release explanation", () => {
  const review = resolveCurrentHoldReason({
    ...base,
    priceCheckError: null,
    hasPendingReview: true,
  });
  assert.match(review.currentHoldReason ?? "", /awaiting review/);
  const manual = resolveCurrentHoldReason({
    ...base,
    holdOrigin: "MANUAL",
    holdReason: "Hold for investigation.",
    priceCheckError: "New ASIN mismatch.",
  });
  assert.equal(manual.currentHoldReason, "Hold for investigation.");
  assert.match(manual.latestCheckMessage ?? "", /New ASIN mismatch/);
  const reviewRequired = resolveCurrentHoldReason({
    ...base,
    holdOrigin: "PRICE_CHECK_UNSAFE_PRICE",
    holdReason: "Unsafe price change requires review.",
    priceCheckError: null,
  });
  assert.equal(reviewRequired.currentHoldReason, "Unsafe price change requires review.");
});
