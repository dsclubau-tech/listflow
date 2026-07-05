import assert from "node:assert/strict";
import test from "node:test";
import {
  getProductIdsMatchingDisplayProfitRange,
  getProductDisplayProfits,
  productMatchesDisplayProfitRange,
} from "@/lib/product-profit";

test("getProductDisplayProfits matches visible variant net profit", () => {
  assert.deepEqual(
    getProductDisplayProfits({
      price: "999",
      amazonPrice: "999",
      variants: [
        {
          buyPrice: "100",
          sellPrice: "140",
          feesPercent: 10,
          feesFixed: 2,
        },
      ],
    }),
    [24]
  );
});

test("getProductDisplayProfits uses product fallback when no variants exist", () => {
  assert.deepEqual(
    getProductDisplayProfits({
      price: "78.89",
      amazonPrice: "69.68",
      variants: [],
    }),
    [9.21]
  );
});

test("productMatchesDisplayProfitRange checks calculated display profit", () => {
  const product = {
    price: "120",
    amazonPrice: "90",
    variants: [
      {
        buyPrice: "64.2",
        sellPrice: "91.05",
        feesPercent: 13,
        feesFixed: 0.33,
      },
    ],
  };

  assert.equal(productMatchesDisplayProfitRange(product, 14, 16), true);
  assert.equal(productMatchesDisplayProfitRange(product, 4, 12), false);
});

test("getProductIdsMatchingDisplayProfitRange scans all candidates before pagination", () => {
  const candidates = Array.from({ length: 125 }, (_, index) => {
    const matching = index >= 100;

    return {
      id: `product-${index + 1}`,
      price: "999",
      amazonPrice: "999",
      variants: [
        {
          buyPrice: "100",
          sellPrice: matching ? "112" : "103",
          feesPercent: 0,
          feesFixed: 0,
        },
      ],
    };
  });

  const ids = getProductIdsMatchingDisplayProfitRange(candidates, 4, 12);

  assert.equal(ids.length, 25);
  assert.equal(ids[0], "product-101");
  assert.equal(ids[24], "product-125");
});
