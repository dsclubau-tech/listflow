import assert from "node:assert/strict";
import test from "node:test";
import { getAutomaticSku, getEbayCustomLabel } from "@/lib/sku";

test("getAutomaticSku uses the Amazon ASIN when automatic SKU filling is enabled", () => {
  assert.equal(
    getAutomaticSku({ asin: " b07vj5lg19 ", automaticSkuFilling: true }),
    "B07VJ5LG19",
  );
});

test("getAutomaticSku returns null when automatic SKU filling is disabled", () => {
  assert.equal(
    getAutomaticSku({ asin: "B07VJ5LG19", automaticSkuFilling: false }),
    null,
  );
});

test("getEbayCustomLabel prefers manual variant SKU over automatic ASIN", () => {
  assert.equal(
    getEbayCustomLabel({
      variantSku: "CUSTOM-123",
      asin: "B07VJ5LG19",
      automaticSkuFilling: true,
    }),
    "CUSTOM-123",
  );
});

