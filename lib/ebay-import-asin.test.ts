import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAsinFromEbayListingFields,
  extractAsinFromEbaySku,
  extractAsinFromNamedSpecifics,
  resolveImportedListingAsin,
} from "@/lib/ebay-import-asin";

test("extracts an Amazon-style ASIN from listing and variation SKUs", () => {
  assert.equal(extractAsinFromEbaySku("B07VJ5LG19"), "B07VJ5LG19");
  assert.equal(extractAsinFromEbaySku("AMZ-B0FBZZPQQG-AU"), "B0FBZZPQQG");
  assert.equal(
    extractAsinFromEbayListingFields({
      listingSku: "CUSTOM-SKU",
      variationSkus: ["SIZE-L", "B0F4X9H3ZW"],
    }),
    "B0F4X9H3ZW",
  );
});

test("extracts general 10-character values only from named ASIN specifics", () => {
  assert.equal(
    extractAsinFromNamedSpecifics({ "Amazon ASIN": " 0306406152 " }),
    "0306406152",
  );
  assert.equal(
    extractAsinFromNamedSpecifics({ "Amazon Item ID": "ASIN: B07VJ5LG19" }),
    "B07VJ5LG19",
  );
});

test("ignores arbitrary item specifics and Amazon media description values", () => {
  assert.equal(
    extractAsinFromEbayListingFields({
      listingSku: "CUSTOM1234",
      itemSpecifics: {
        Model: "B0FBZZPQQG",
        Description: "https://m.media-amazon.com/images/I/B0ABCDEF12.jpg",
      },
    }),
    null,
  );
});

test("does not treat an arbitrary 10-character custom SKU as an ASIN", () => {
  assert.equal(extractAsinFromEbaySku("CUSTOM1234"), null);
  assert.equal(extractAsinFromEbaySku("1234567890"), null);
});

test("falls back to a persisted eBay listing ASIN when eBay has no usable SKU", () => {
  assert.equal(
    resolveImportedListingAsin({
      listingSku: null,
      persistedAsin: " b0bjq9ft24 ",
    }),
    "B0BJQ9FT24",
  );
  assert.equal(
    resolveImportedListingAsin({ persistedAsin: "invalid" }),
    null,
  );
});

test("prefers the current eBay listing ASIN over a stale persisted value", () => {
  assert.equal(
    resolveImportedListingAsin({
      listingSku: "B0CPLWFF3J",
      persistedAsin: "B0BJQ9FT24",
    }),
    "B0CPLWFF3J",
  );
});
