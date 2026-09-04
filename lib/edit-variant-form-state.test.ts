import test from "node:test";
import assert from "node:assert/strict";
import { buildFormState } from "@/components/EditVariantModal";
import type { VariantRecord } from "@/types/variant";
import {
  calculateProfitPercentFromSellPrice,
  calculateSellPrice,
  calculateNetProfit,
} from "@/lib/variant-pricing";

test("buildFormState normalizes legacy variant where upload profit was saved in profitFixed", () => {
  // Simulates a variant imported with buyPrice 339.98, $14 default upload profit, 13% eBay fees + 0.33 fixed fee.
  // In the legacy system, profitPercent was 0 and profitFixed was 14.
  const legacyVariant: VariantRecord = {
    id: "var_legacy_1",
    sku: "SKU-1",
    title: "Legacy Variant",
    images: ["https://example.com/item.jpg"],
    buyPrice: "339.98",
    feesPercent: 13,
    feesFixed: 0.33,
    profitPercent: 0,
    profitFixed: 14,
    promotedAdPercent: 0,
    sellPrice: "407.25",
    quantity: 5,
    status: "IN_STOCK",
    automation: null,
    includeShipping: true,
    allowMarketplace: true,
    roundCents: null,
    itemSpecifics: {},
    productId: "prod_1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const form = buildFormState({
    variant: legacyVariant,
    defaultBuyPrice: 339.98,
    defaultQuantity: 5,
    defaultImages: ["https://example.com/item.jpg"],
    defaultSku: "SKU-1",
    isProductOnHold: false,
    pricingDefaults: {
      feesPercent: 13,
      feesFixed: 0.33,
      defaultUploadProfitPercent: 0,
      defaultUploadProfitFixed: 14,
      minimumProfit: 1,
    },
  });

  // Profit % must reflect the true base margin (14.00 / 339.98 * 100 = 4.12%)
  assert.equal(form.profitPercent, "4.12");
  // Additional Profit must be reset to 0.00 because no user markup was added
  assert.equal(form.profitFixed, "0");
  // Sell price and buy price remain intact
  assert.equal(form.sellPrice, "407.25");
  assert.equal(form.buyPrice, "339.98");
});

test("buildFormState applies supplier default upload profit to sell price and sets Additional Profit to 0 for new variants", () => {
  const form = buildFormState({
    variant: null,
    defaultBuyPrice: 339.98,
    defaultQuantity: 3,
    defaultImages: ["https://example.com/new.jpg"],
    defaultSku: "SKU-NEW",
    isProductOnHold: false,
    pricingDefaults: {
      feesPercent: 13,
      feesFixed: 0.33,
      defaultUploadProfitPercent: 0,
      defaultUploadProfitFixed: 14,
      minimumProfit: 1,
    },
  });

  // Sell price calculated using default upload profit of $14: (339.98 + 0.33 + 14) / 0.87 = 407.25
  assert.equal(form.sellPrice, "407.25");
  // Base Profit % captures the 4.12% margin from upload profit
  assert.equal(form.profitPercent, "4.12");
  // Additional Profit (per-variant manual markup) must initialize to 0
  assert.equal(form.profitFixed, "0");
});

test("buildFormState preserves user-entered Additional Profit when profitPercent is non-zero", () => {
  // A variant where the user explicitly entered 10% base profit and 5.00 Additional Profit
  const customVariant: VariantRecord = {
    id: "var_custom_1",
    sku: "SKU-CUSTOM",
    title: "Custom Variant",
    images: ["https://example.com/custom.jpg"],
    buyPrice: "100.00",
    feesPercent: 13,
    feesFixed: 0.33,
    profitPercent: 10,
    profitFixed: 5,
    promotedAdPercent: 0,
    sellPrice: "132.56",
    quantity: 2,
    status: "IN_STOCK",
    automation: null,
    includeShipping: true,
    allowMarketplace: true,
    roundCents: null,
    itemSpecifics: {},
    productId: "prod_2",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const form = buildFormState({
    variant: customVariant,
    defaultBuyPrice: 100,
    defaultQuantity: 2,
    defaultImages: ["https://example.com/custom.jpg"],
    defaultSku: "SKU-CUSTOM",
    isProductOnHold: false,
    pricingDefaults: {
      feesPercent: 13,
      feesFixed: 0.33,
      defaultUploadProfitPercent: 0,
      defaultUploadProfitFixed: 14,
      minimumProfit: 1,
    },
  });

  // User-entered Profit % and Additional Profit are both preserved
  assert.equal(form.profitPercent, "10");
  assert.equal(form.profitFixed, "5");
});

test("editing sell price dynamically derives profitPercent while keeping Additional Profit intact", () => {
  const buyPrice = 339.98;
  const feesPercent = 13;
  const feesFixed = 0.33;
  const additionalProfit = 0;

  // At original sell price 407.25 -> 4.12%
  const initialProfitPercent = calculateProfitPercentFromSellPrice({
    buyPrice,
    sellPrice: 407.25,
    feesPercent,
    feesFixed,
    profitFixed: additionalProfit,
  });
  assert.equal(initialProfitPercent, 4.12);

  // User raises sell price to 450.00 -> Net profit = 450 - 339.98 - (450 * 0.13 + 0.33) = 51.19
  // 51.19 / 339.98 * 100 = 15.06%
  const updatedProfitPercent = calculateProfitPercentFromSellPrice({
    buyPrice,
    sellPrice: 450.0,
    feesPercent,
    feesFixed,
    profitFixed: additionalProfit,
  });
  assert.equal(updatedProfitPercent, 15.06);

  // If user sets Additional Profit to 5.00:
  const newSellPrice = calculateSellPrice({
    buyPrice,
    feesPercent,
    feesFixed,
    profitPercent: initialProfitPercent,
    profitFixed: 5,
    roundCents: null,
  });
  // (339.98 + 0.33 + 339.98 * 0.0412 + 5.00) / 0.87 = 413.01
  assert.equal(newSellPrice, 413.01);

  // Net profit at 413.01 = 413.01 - 339.98 - (413.01 * 0.13 + 0.33) = 19.01 ($14 base + $5 additional)
  const netProfit = calculateNetProfit({
    buyPrice,
    sellPrice: newSellPrice,
    feesPercent,
    feesFixed,
  });
  assert.equal(netProfit, 19.01);
});
