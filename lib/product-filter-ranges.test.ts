import assert from "node:assert/strict";
import test from "node:test";
import { getProductRangeFilterValidationError } from "@/lib/product-filter-ranges";

test("range validation accepts decimal, zero, equal, and one-sided fee bounds", () => {
  assert.equal(getProductRangeFilterValidationError({ feesPercentMin: "0.35", feesPercentMax: "13.25" }), null);
  assert.equal(getProductRangeFilterValidationError({ feesFixedMin: "3.50", feesFixedMax: "3.50" }), null);
  assert.equal(getProductRangeFilterValidationError({ feesPercentMin: "0" }), null);
  assert.equal(getProductRangeFilterValidationError({ feesFixedMax: "2.75" }), null);
});

test("range validation rejects invalid, negative, and reversed fee bounds", () => {
  assert.match(getProductRangeFilterValidationError({ feesPercentMin: "abc" }) ?? "", /valid numbers/);
  assert.match(getProductRangeFilterValidationError({ feesFixedMin: "-0.01" }) ?? "", /cannot be negative/);
  assert.match(
    getProductRangeFilterValidationError({ feesPercentMin: "13.25", feesPercentMax: "0.35" }) ?? "",
    /minimum cannot be greater/,
  );
});
