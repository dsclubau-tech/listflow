import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getProductListingStatus } from "@/lib/product-listing-status";

test("on-hold takes precedence over zero inventory", () => {
  assert.equal(
    getProductListingStatus({
      status: "ON_HOLD",
      quantity: 0,
      amazonStockLeft: 0,
      variants: [{ quantity: 0, status: "OUT_OF_STOCK" }],
    }),
    "on-hold",
  );
});

test("zero supplier stock is out of stock", () => {
  assert.equal(
    getProductListingStatus({
      status: "IMPORTED",
      quantity: 4,
      amazonStockLeft: 0,
      variants: [{ quantity: 4, status: "IN_STOCK" }],
    }),
    "out-of-stock",
  );
});

test("unknown supplier verification is unavailable even with local quantity", () => {
  assert.equal(
    getProductListingStatus({
      status: "IMPORTED",
      quantity: 5,
      amazonAvailability: "UNKNOWN",
      priceCheckFailureCode: "AMAZON_BUYBOX_UNAVAILABLE",
    }),
    "unavailable",
  );
});

test("a product is in stock when at least one variant is available", () => {
  assert.equal(
    getProductListingStatus({
      status: "IMPORTED",
      quantity: 0,
      variants: [
        { quantity: 0, status: "OUT_OF_STOCK" },
        { quantity: 2, status: "IN_STOCK" },
      ],
    }),
    "in-stock",
  );
});

test("a product is out of stock when every variant is unavailable", () => {
  assert.equal(
    getProductListingStatus({
      status: "IMPORTED",
      quantity: 5,
      variants: [
        { quantity: 0, status: "IN_STOCK" },
        { quantity: 3, status: "OUT_OF_STOCK" },
      ],
    }),
    "out-of-stock",
  );
});

test("products without variants use their listing quantity", () => {
  assert.equal(
    getProductListingStatus({ status: "IMPORTED", quantity: 1 }),
    "in-stock",
  );
  assert.equal(
    getProductListingStatus({ status: "IMPORTED", quantity: 0 }),
    "out-of-stock",
  );
});

test("remove dialog waits for an explicit confirmation", () => {
  const source = readFileSync("components/DraftsTable.tsx", "utf8");

  assert.match(source, /onClick=\{\(\) => setRemovalAction\("listflow-only"\)\}/);
  assert.match(source, /onClick=\{\(\) => setRemovalAction\("end-ebay"\)\}/);
  assert.match(source, /onClick=\{\(\) => void handleConfirmRemoval\(\)\}/);
  assert.match(source, /disabled=\{!removalAction \|\| Boolean\(deletingId \|\| endingId\)\}/);
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => void handleRemoveFromListflow\(removalProduct\.id\)\}/,
  );
});
