import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amazonPriceComparisonOutcomesMatch,
  normalizeAmazonPriceComparisonOutcome,
} from "./amazon-price-comparison";

test("comparison includes price, shipping, stock, mode, variant, and identity", () => {
  const base = {
    kind: "result" as const,
    value: {
      price: 24.95,
      rawPrice: 20,
      shippingPrice: 4.95,
      stockLeft: 2,
      priceMode: "REGULAR" as const,
      priceChoices: { regular: 24.95, deal: null },
      detectedAsin: "B000000001",
      asinRedirected: false,
    },
  };
  assert.equal(amazonPriceComparisonOutcomesMatch(base, base), true);
  assert.equal(
    amazonPriceComparisonOutcomesMatch(base, {
      ...base,
      value: { ...base.value, shippingPrice: 0 },
    }),
    false,
  );
});

test("comparison normalizes missing optional result fields", () => {
  const normalized = normalizeAmazonPriceComparisonOutcome({
    kind: "result",
    value: { price: null, stockLeft: null },
  });
  assert.equal(normalized.kind, "result");
  assert.equal(normalized.shippingPrice, null);
  assert.equal(normalized.variantSelectionFailed, false);
});

test("errors compare their classification and message", () => {
  const technical = {
    kind: "error" as const,
    code: "TECHNICAL_ERROR",
    message: "challenge",
  };
  assert.equal(amazonPriceComparisonOutcomesMatch(technical, technical), true);
  assert.equal(
    amazonPriceComparisonOutcomesMatch(technical, {
      ...technical,
      code: "AMAZON_OUT_OF_STOCK",
    }),
    false,
  );
});

test("comparison command does not import persistence or eBay modules", () => {
  const source = readFileSync(
    "scripts/compare-price-check-scrapers.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /(?:prisma|price-check-jobs|from ["'][^"']*ebay)/i);
});
