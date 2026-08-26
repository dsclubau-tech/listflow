import assert from "node:assert/strict";
import test from "node:test";
import { addAdditionalProfitToExistingVariant } from "@/lib/variant-additional-profit";
import { calculateNetProfit } from "@/lib/variant-pricing";

test("adds fixed supplier profit on top of profit already present in sell price", () => {
  const result = addAdditionalProfitToExistingVariant({
    buyPrice: 101.99,
    sellPrice: 104,
    feesPercent: 0,
    feesFixed: 0,
    profitPercent: 0,
    additionalProfitPercent: 0,
    additionalProfitFixed: 14,
    roundCents: null,
  });

  assert.deepEqual(result, {
    existingProfitFixed: 2.01,
    profitPercent: 0,
    profitFixed: 16.01,
    sellPrice: 118,
  });
});

test("preserves existing net profit after fees before adding supplier profit", () => {
  const result = addAdditionalProfitToExistingVariant({
    buyPrice: 100,
    sellPrice: 130,
    feesPercent: 10,
    feesFixed: 2,
    profitPercent: 0,
    additionalProfitPercent: 0,
    additionalProfitFixed: 14,
    roundCents: null,
  });

  assert.equal(result.existingProfitFixed, 15);
  assert.equal(
    calculateNetProfit({
      buyPrice: 100,
      sellPrice: result.sellPrice,
      feesPercent: 10,
      feesFixed: 2,
    }),
    29,
  );
});
