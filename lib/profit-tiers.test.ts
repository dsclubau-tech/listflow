import assert from "node:assert/strict";
import test from "node:test";
import { getTierProfitPercent } from "@/lib/profit-tiers";

test("getTierProfitPercent returns 0 when no tiers provided", () => {
  assert.equal(getTierProfitPercent(50, null), 0);
  assert.equal(getTierProfitPercent(50, []), 0);
});

test("getTierProfitPercent matches lowest threshold first", () => {
  const tiers = [
    { maxPrice: 150, profitPercent: 11 },
    { maxPrice: 100, profitPercent: 9 },
    { maxPrice: 200, profitPercent: 12 },
  ];

  // Under $100 -> 9%
  assert.equal(getTierProfitPercent(50, tiers), 9);
  assert.equal(getTierProfitPercent(99.99, tiers), 9);

  // $100 to $149.99 -> 11%
  assert.equal(getTierProfitPercent(100, tiers), 11);
  assert.equal(getTierProfitPercent(149.99, tiers), 11);

  // $150 to $199.99 -> 12%
  assert.equal(getTierProfitPercent(150, tiers), 12);
  assert.equal(getTierProfitPercent(199.99, tiers), 12);

  // $200 and above -> 0% (no tier match, fallback to flat profit)
  assert.equal(getTierProfitPercent(200, tiers), 0);
  assert.equal(getTierProfitPercent(350, tiers), 0);
});

test("getTierProfitPercent ignores non-positive tiers and prices", () => {
  const tiers = [
    { maxPrice: 0, profitPercent: 15 },
    { maxPrice: 100, profitPercent: 0 },
    { maxPrice: 100, profitPercent: 10 },
  ];

  assert.equal(getTierProfitPercent(-5, tiers), 0);
  assert.equal(getTierProfitPercent(0, tiers), 0);
  assert.equal(getTierProfitPercent(50, tiers), 10);
});
