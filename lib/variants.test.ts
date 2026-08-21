import test from "node:test";
import assert from "node:assert/strict";

async function getBuildDefaultVariantData() {
  process.env.DATABASE_URL ??=
    "postgresql://listflow:test@127.0.0.1:5432/listflow_test";
  return (await import("@/lib/variants")).buildDefaultVariantData;
}

test("buildDefaultVariantData applies supplier pricing defaults when creating default variant", async () => {
  const buildDefaultVariantData = await getBuildDefaultVariantData();
  const variant = buildDefaultVariantData({
    id: "product_123",
    price: 100,
    quantity: 2,
    images: ["https://example.com/img1.jpg"],
    asin: "B0GLYN8VJ4",
    automaticSkuFilling: true,
    feesPercent: 13,
    feesFixed: 0.33,
    profitPercent: 0,
    profitFixed: 14,
    minimumProfit: 1,
  });

  assert.equal(variant.sku, "B0GLYN8VJ4");
  assert.equal(variant.buyPrice, 100);
  assert.equal(variant.feesPercent, 13);
  assert.equal(variant.feesFixed, 0.33);
  assert.equal(variant.profitPercent, 0);
  assert.equal(variant.profitFixed, 14);
  assert.equal(variant.status, "IN_STOCK");
  // Sell price for buy=100, fees=13%, feesFixed=0.33, profit=14 -> (100 + 0.33 + 14) / (1 - 0.13) = 114.33 / 0.87 = 131.41
  assert.equal(variant.sellPrice, 131.41);
});

test("buildDefaultVariantData defaults to zero when pricing parameters are omitted", async () => {
  const buildDefaultVariantData = await getBuildDefaultVariantData();
  const variant = buildDefaultVariantData({
    id: "product_456",
    price: 50,
    quantity: 0,
    images: [],
    asin: null,
  });

  assert.equal(variant.buyPrice, 50);
  assert.equal(variant.sellPrice, 50);
  assert.equal(variant.feesPercent, 0);
  assert.equal(variant.feesFixed, 0);
  assert.equal(variant.profitPercent, 0);
  assert.equal(variant.profitFixed, 0);
  assert.equal(variant.status, "OUT_OF_STOCK");
});
