import assert from "node:assert/strict";
import test from "node:test";
import { getTierProfitPercent, type ProfitTierConfig } from "@/lib/profit-tiers";

test("getTierProfitPercent returns 0 when no tiers provided", () => {
  assert.equal(getTierProfitPercent(50, null), 0);
  assert.equal(getTierProfitPercent(50, []), 0);
});

test("getTierProfitPercent matches lowest threshold first for legacy LOWER_THAN tiers", () => {
  const tiers: ProfitTierConfig[] = [
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

  // $200 and above with no higher-than tier -> 0%
  assert.equal(getTierProfitPercent(200, tiers), 0);
  assert.equal(getTierProfitPercent(350, tiers), 0);
});

test("getTierProfitPercent matches HIGHER_THAN tiers correctly", () => {
  const tiers: ProfitTierConfig[] = [
    { tierType: "HIGHER_THAN", minPrice: 200, profitPercent: 15 },
    { tierType: "HIGHER_THAN", minPrice: 500, profitPercent: 20 },
  ];

  // Under $200 -> 0% (does not match higher-than)
  assert.equal(getTierProfitPercent(50, tiers), 0);
  assert.equal(getTierProfitPercent(199.99, tiers), 0);

  // $200 to $499.99 -> 15%
  assert.equal(getTierProfitPercent(200, tiers), 15);
  assert.equal(getTierProfitPercent(350, tiers), 15);
  assert.equal(getTierProfitPercent(499.99, tiers), 15);

  // $500 and above -> 20%
  assert.equal(getTierProfitPercent(500, tiers), 20);
  assert.equal(getTierProfitPercent(1200, tiers), 20);
});

test("getTierProfitPercent matches BETWEEN tiers correctly", () => {
  const tiers: ProfitTierConfig[] = [
    { tierType: "BETWEEN", minPrice: 100, maxPrice: 200, profitPercent: 12 },
    { tierType: "BETWEEN", minPrice: 200, maxPrice: 500, profitPercent: 16 },
  ];

  assert.equal(getTierProfitPercent(50, tiers), 0);
  assert.equal(getTierProfitPercent(100, tiers), 12);
  assert.equal(getTierProfitPercent(199.99, tiers), 12);
  assert.equal(getTierProfitPercent(200, tiers), 16);
  assert.equal(getTierProfitPercent(499.99, tiers), 16);
  assert.equal(getTierProfitPercent(500, tiers), 0);
});

test("getTierProfitPercent seamlessly combines LOWER_THAN and HIGHER_THAN tiers", () => {
  const tiers: ProfitTierConfig[] = [
    { tierType: "LOWER_THAN", maxPrice: 100, profitPercent: 9 },
    { tierType: "LOWER_THAN", maxPrice: 150, profitPercent: 11 },
    { tierType: "HIGHER_THAN", minPrice: 200, profitPercent: 15 },
    { tierType: "HIGHER_THAN", minPrice: 500, profitPercent: 20 },
  ];

  // Under $100 -> 9%
  assert.equal(getTierProfitPercent(45, tiers), 9);
  // $120 -> 11%
  assert.equal(getTierProfitPercent(120, tiers), 11);
  // $180 -> in gap between $150 and $200 -> 0% extra
  assert.equal(getTierProfitPercent(180, tiers), 0);
  // $250 -> higher than 200 -> 15%
  assert.equal(getTierProfitPercent(250, tiers), 15);
  // $600 -> higher than 500 -> 20%
  assert.equal(getTierProfitPercent(600, tiers), 20);
});

test("getTierProfitPercent ignores non-positive tiers and invalid inputs", () => {
  const tiers: ProfitTierConfig[] = [
    { maxPrice: 0, profitPercent: 15 },
    { maxPrice: 100, profitPercent: 0 },
    { tierType: "HIGHER_THAN", minPrice: 0, profitPercent: 10 },
    { tierType: "HIGHER_THAN", minPrice: -50, profitPercent: 10 },
    { tierType: "LOWER_THAN", maxPrice: 100, profitPercent: 10 },
  ];

  assert.equal(getTierProfitPercent(-5, tiers), 0);
  assert.equal(getTierProfitPercent(0, tiers), 0);
  assert.equal(getTierProfitPercent(50, tiers), 10);
});
