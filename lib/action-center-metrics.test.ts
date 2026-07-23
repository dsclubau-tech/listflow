import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePendingReviewMetrics,
  getEffectiveListingQuantity,
  getLatestPendingReviewHistory,
  getOnHoldReason,
  getStoredQuantityAfterEdit,
} from "@/lib/action-center-metrics";

test("pending review change uses the absolute Amazon buy-price difference", () => {
  const base = {
    newSellPrice: 140,
    feesPercent: 10,
    feesFixed: 2,
    promotedAdStatus: "NOT_PROMOTED",
    promotedAdPercent: 0,
  };

  assert.equal(
    calculatePendingReviewMetrics({
      ...base,
      previousBuyPrice: 100,
      newBuyPrice: 112.34,
    }).changeAmount,
    12.34,
  );
  assert.equal(
    calculatePendingReviewMetrics({
      ...base,
      previousBuyPrice: 112.34,
      newBuyPrice: 100,
    }).changeAmount,
    -12.34,
  );
  assert.equal(
    calculatePendingReviewMetrics({
      ...base,
      previousBuyPrice: 100,
      newBuyPrice: 100,
    }).changeAmount,
    0,
  );
});

test("pending review profit subtracts transaction and known promoted-ad fees", () => {
  assert.deepEqual(
    calculatePendingReviewMetrics({
      previousBuyPrice: 90,
      newBuyPrice: 100,
      newSellPrice: 140,
      feesPercent: 10,
      feesFixed: 2,
      promotedAdStatus: "PROMOTED",
      promotedAdPercent: 5,
    }),
    { changeAmount: 10, profit: 17 },
  );
});

test("pending review profit ignores unavailable or inactive promoted-ad rates", () => {
  const base = {
    previousBuyPrice: 90,
    newBuyPrice: 100,
    newSellPrice: 140,
    feesPercent: 10,
    feesFixed: 2,
  };

  assert.equal(
    calculatePendingReviewMetrics({
      ...base,
      promotedAdStatus: "NOT_PROMOTED",
      promotedAdPercent: 5,
    }).profit,
    24,
  );
  assert.equal(
    calculatePendingReviewMetrics({
      ...base,
      promotedAdStatus: "PROMOTED",
      promotedAdPercent: null,
    }).profit,
    24,
  );
});

test("pending review profit can be negative and is unavailable without variant fees", () => {
  assert.equal(
    calculatePendingReviewMetrics({
      previousBuyPrice: 90,
      newBuyPrice: 95,
      newSellPrice: 100,
      feesPercent: 10,
      feesFixed: 1,
      promotedAdStatus: "PROMOTED",
      promotedAdPercent: 5,
    }).profit,
    -11,
  );
  assert.equal(
    calculatePendingReviewMetrics({
      previousBuyPrice: 90,
      newBuyPrice: 95,
      newSellPrice: 100,
      feesPercent: null,
      feesFixed: null,
      promotedAdStatus: "PROMOTED",
      promotedAdPercent: 5,
    }).profit,
    null,
  );
});

test("latest pending review history is selected by detection time", () => {
  const older = { id: "older", createdAt: new Date("2026-07-19T10:00:00Z") };
  const latest = { id: "latest", createdAt: new Date("2026-07-19T11:00:00Z") };

  assert.equal(
    getLatestPendingReviewHistory([latest, older])?.id,
    "latest",
  );
  assert.equal(getLatestPendingReviewHistory([]), null);
});

test("on-hold quantity is displayed as zero without changing resume quantity", () => {
  assert.equal(getEffectiveListingQuantity("ON_HOLD", 1), 0);
  assert.equal(getEffectiveListingQuantity("IMPORTED", 1), 1);
  assert.equal(getStoredQuantityAfterEdit("ON_HOLD", 0, 1), 1);
  assert.equal(getStoredQuantityAfterEdit("ON_HOLD", 4, 1), 4);
  assert.equal(getStoredQuantityAfterEdit("IMPORTED", 0, 1), 0);
});

test("on-hold reason explains every supported hold path", () => {
  assert.equal(
    getOnHoldReason({
      priceCheckError: "Amazon price is unavailable.",
      amazonStockLeft: 0,
      savedQuantity: 1,
    }),
    "Automatic hold after failed price check: Amazon price is unavailable.",
  );
  assert.equal(
    getOnHoldReason({
      priceCheckError: null,
      amazonStockLeft: null,
      savedQuantity: 0,
    }),
    "Listing quantity was set to 0.",
  );
  assert.equal(
    getOnHoldReason({
      priceCheckError: null,
      amazonStockLeft: 2,
      savedQuantity: 1,
    }),
    "Low Amazon stock (2 left).",
  );
  assert.equal(
    getOnHoldReason({
      priceCheckError: null,
      amazonStockLeft: 12,
      savedQuantity: 1,
    }),
    "Put on hold manually.",
  );
});
