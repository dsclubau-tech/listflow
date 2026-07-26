import assert from "node:assert/strict";
import test from "node:test";
import { getPromotedListingProfitPreview } from "./promoted-listing-profit";

test("promotion preview deducts the selected ad rate from existing profit", () => {
  const preview = getPromotedListingProfitPreview(
    [
      {
        id: "product-1",
        title: "Example listing",
        price: "100",
        variants: [
          {
            id: "variant-1",
            title: "Default",
            buyPrice: "60",
            sellPrice: "100",
            feesPercent: 10,
            feesFixed: 0,
          },
        ],
      },
    ],
    3,
  );

  assert.equal(preview.profitBeforeAdFee, 30);
  assert.equal(preview.potentialAdFee, 3);
  assert.equal(preview.profitAfterAdFee, 27);
  assert.equal(preview.pricedProductCount, 1);
  assert.equal(preview.unpricedProductCount, 0);
});

test("promotion preview totals variants and preserves negative projected profit", () => {
  const preview = getPromotedListingProfitPreview(
    [
      {
        id: "product-1",
        title: "Two-variant listing",
        price: "0",
        variants: [
          {
            id: "variant-1",
            buyPrice: "90",
            sellPrice: "100",
            feesPercent: 5,
            feesFixed: 0,
          },
          {
            id: "variant-2",
            buyPrice: "48",
            sellPrice: "50",
            feesPercent: 2,
            feesFixed: 1,
          },
        ],
      },
    ],
    5,
  );

  assert.equal(preview.profitBeforeAdFee, 5);
  assert.equal(preview.potentialAdFee, 7.5);
  assert.equal(preview.profitAfterAdFee, -2.5);
  assert.equal(preview.rows[1]?.profitAfterAdFee, -2.5);
});

test("promotion preview uses product fallback prices and reports missing pricing", () => {
  const preview = getPromotedListingProfitPreview(
    [
      {
        id: "product-1",
        title: "Fallback listing",
        amazonPrice: "50",
        price: "80",
      },
      {
        id: "product-2",
        title: "Missing supplier price",
        amazonPrice: null,
        price: "80",
      },
    ],
    2.5,
  );

  assert.equal(preview.profitBeforeAdFee, 30);
  assert.equal(preview.potentialAdFee, 2);
  assert.equal(preview.profitAfterAdFee, 28);
  assert.equal(preview.pricedProductCount, 1);
  assert.equal(preview.unpricedProductCount, 1);
});
