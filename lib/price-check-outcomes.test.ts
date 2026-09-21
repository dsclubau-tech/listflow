import assert from "node:assert/strict";
import { test } from "node:test";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";
import { getPriceCheckProductOutcomeForFailure } from "./price-check-failures";

test("availability failures stay separate from technical failures", () => {
  assert.equal(
    getPriceCheckProductOutcomeForFailure(
      PriceCheckFailureCode.AMAZON_OUT_OF_STOCK,
    ),
    "UNAVAILABLE",
  );
  assert.equal(
    getPriceCheckProductOutcomeForFailure(
      PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
    ),
    "UNAVAILABLE",
  );
  assert.equal(
    getPriceCheckProductOutcomeForFailure(PriceCheckFailureCode.TECHNICAL_ERROR),
    "TECHNICAL_ERROR",
  );
});

test("identity, variant, baseline, and safety failures need verification", () => {
  for (const code of [
    PriceCheckFailureCode.AMAZON_ASIN_REDIRECT,
    PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED,
    PriceCheckFailureCode.MISSING_BASELINE,
    PriceCheckFailureCode.UNSAFE_PRICE_CHANGE,
  ]) {
    assert.equal(getPriceCheckProductOutcomeForFailure(code), "NEEDS_VERIFICATION");
  }
});
