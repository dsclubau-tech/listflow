import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRoundCents,
  calculateNetProfit,
  calculateProfitFixedFromSellPrice,
  calculateProfitPercentFromSellPrice,
  calculateSellPrice,
  calculateTotalFees,
  calculateTotalProfit,
} from "@/lib/variant-pricing";

test("calculateSellPrice returns buy price when fees and profit are zero", () => {
  assert.equal(
    calculateSellPrice({
      buyPrice: 24.5,
      feesPercent: 0,
      feesFixed: 0,
      profitPercent: 0,
      profitFixed: 0,
      roundCents: null,
    }),
    24.5
  );
});

test("calculateSellPrice handles mixed fixed fees and profit", () => {
  assert.equal(
    calculateSellPrice({
      buyPrice: 10,
      feesPercent: 13,
      feesFixed: 0.33,
      profitPercent: 0,
      profitFixed: 1,
      roundCents: null,
    }),
    13.02
  );
});

test("calculateSellPrice enforces minimumProfit when raw profit is lower", () => {
  assert.equal(
    calculateSellPrice({
      buyPrice: 100,
      feesPercent: 13,
      feesFixed: 0.33,
      profitPercent: 0,
      profitFixed: 0,
      roundCents: null,
      minimumProfit: 2,
    }),
    117.62
  );
});

test("applyRoundCents rounds upward to .99", () => {
  assert.equal(applyRoundCents(13.02, 0.99), 13.99);
});

test("calculateProfitFixedFromSellPrice inverts the sell-price formula", () => {
  assert.equal(
    calculateProfitFixedFromSellPrice({
      buyPrice: 10,
      sellPrice: 13.02,
      feesPercent: 13,
      feesFixed: 0.33,
      profitPercent: 0,
    }),
    1
  );
});

test("calculateProfitPercentFromSellPrice derives percentage profit on cost", () => {
  // Buy 44.95, Sell 67.94, 13% fees + 0.33 -> net profit 13.83 -> (13.83 / 44.95) * 100 = 30.77%
  assert.equal(
    calculateProfitPercentFromSellPrice({
      buyPrice: 44.95,
      sellPrice: 67.94,
      feesPercent: 13,
      feesFixed: 0.33,
      profitFixed: 0,
    }),
    30.76
  );

  // Buy 75.99, Sell 105.89, 13% fees + 0.33 -> net profit 15.80 -> (15.80 / 75.99) * 100 = 20.80%
  assert.equal(
    calculateProfitPercentFromSellPrice({
      buyPrice: 75.99,
      sellPrice: 105.89,
      feesPercent: 13,
      feesFixed: 0.33,
      profitFixed: 0,
    }),
    20.8
  );
});

test("calculateTotalFees and calculateTotalProfit derive display totals", () => {
  assert.equal(
    calculateTotalFees({
      sellPrice: 50,
      feesPercent: 12,
      feesFixed: 1.5,
    }),
    7.5
  );

  assert.equal(
    calculateTotalProfit({
      sellPrice: 50,
      profitPercent: 10,
      profitFixed: 2,
    }),
    7
  );
});

test("calculateNetProfit derives actual margin after buy price and fees", () => {
  assert.equal(
    calculateNetProfit({
      buyPrice: 149.9,
      sellPrice: 172.68,
      feesPercent: 13,
      feesFixed: 0.33,
    }),
    0
  );

  assert.equal(
    calculateNetProfit({
      buyPrice: 100,
      sellPrice: 140,
      feesPercent: 10,
      feesFixed: 2,
      promotedAdPercent: 5,
    }),
    17
  );
});
