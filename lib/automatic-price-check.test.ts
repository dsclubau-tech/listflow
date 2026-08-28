import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_HOLD_PRICE_CHECK_FAILURE_CODES,
  isAutoHoldPriceCheckFailureCode,
} from "./price-check-failures";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";

describe("automatic-price-check configuration", () => {
  test("runs on an exact 8-hour schedule interval", () => {
    const AUTOMATIC_PRICE_CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;
    const AUTOMATIC_PRICE_CHECK_TASK_KEY = "automatic-price-check";
    assert.equal(AUTOMATIC_PRICE_CHECK_INTERVAL_MS, 28800000);
    assert.equal(AUTOMATIC_PRICE_CHECK_TASK_KEY, "automatic-price-check");
  });

  test("AMAZON_VARIANT_SELECTION_REQUIRED is NOT an auto-hold failure code", () => {
    assert.equal(
      isAutoHoldPriceCheckFailureCode(
        PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED
      ),
      false,
      "Variant selection requirement should flag for review and NOT place eBay listing on hold"
    );

    assert.equal(
      (AUTO_HOLD_PRICE_CHECK_FAILURE_CODES as readonly string[]).includes(
        PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED
      ),
      false
    );
  });

  test("Out of stock and price unavailable remain auto-hold failure codes", () => {
    assert.equal(
      isAutoHoldPriceCheckFailureCode(
        PriceCheckFailureCode.AMAZON_OUT_OF_STOCK
      ),
      true
    );
    assert.equal(
      isAutoHoldPriceCheckFailureCode(
        PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE
      ),
      true
    );
  });
});
