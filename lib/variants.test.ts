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

test("buildDefaultVariantData handles Decimal object prices correctly", async () => {
  const buildDefaultVariantData = await getBuildDefaultVariantData();
  // Simulating Prisma Decimal object
  const decimalPrice = {
    toNumber() {
      return 75;
    },
    valueOf() {
      return "75";
    },
  };

  const variant = buildDefaultVariantData({
    id: "product_789",
    price: decimalPrice as unknown as number,
    quantity: 1,
    images: [],
    asin: "B0FNCKZ5DY",
    feesPercent: 13,
    feesFixed: 0.33,
    profitPercent: 0,
    profitFixed: 14,
    minimumProfit: 1,
  });

  // buy = 75, fees = 13%, feeFixed = 0.33, profitFixed = 14 -> (75 + 0.33 + 14) / (1 - 0.13) = 89.33 / 0.87 = 102.68
  assert.equal(variant.sellPrice, 102.68);
});

