import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_HOLD_PRICE_CHECK_FAILURE_CODES,
  isAutoHoldPriceCheckFailureCode,
} from "./price-check-failures";
import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";

describe("automatic-price-check configuration", () => {
  test("configures 3 fixed daily check times (4:10 AM, 12:00 PM, 8:00 PM)", async () => {
    const { AUTOMATIC_PRICE_CHECK_TIMES, AUTOMATIC_PRICE_CHECK_TASK_KEY, getNextScheduledCheckTime } =
      await import("./automatic-price-check-schedule");
    assert.equal(AUTOMATIC_PRICE_CHECK_TASK_KEY, "automatic-price-check");
    assert.equal(AUTOMATIC_PRICE_CHECK_TIMES.length, 3);
    assert.deepEqual(AUTOMATIC_PRICE_CHECK_TIMES[0], { hour: 4, minute: 10, label: "4:10 AM" });
    assert.deepEqual(AUTOMATIC_PRICE_CHECK_TIMES[1], { hour: 12, minute: 0, label: "12:00 PM" });
    assert.deepEqual(AUTOMATIC_PRICE_CHECK_TIMES[2], { hour: 20, minute: 0, label: "8:00 PM" });

    // Test time progression:
    // 1:00 AM -> next is 4:10 AM today
    const at1am = new Date(2026, 8, 1, 1, 0, 0);
    const nextFrom1am = getNextScheduledCheckTime(at1am);
    assert.equal(nextFrom1am.getHours(), 4);
    assert.equal(nextFrom1am.getMinutes(), 10);
    assert.equal(nextFrom1am.getDate(), 1);

    // 5:00 AM -> next is 12:00 PM today
    const at5am = new Date(2026, 8, 1, 5, 0, 0);
    const nextFrom5am = getNextScheduledCheckTime(at5am);
    assert.equal(nextFrom5am.getHours(), 12);
    assert.equal(nextFrom5am.getMinutes(), 0);
    assert.equal(nextFrom5am.getDate(), 1);

    // 1:00 PM -> next is 8:00 PM today
    const at1pm = new Date(2026, 8, 1, 13, 0, 0);
    const nextFrom1pm = getNextScheduledCheckTime(at1pm);
    assert.equal(nextFrom1pm.getHours(), 20);
    assert.equal(nextFrom1pm.getMinutes(), 0);
    assert.equal(nextFrom1pm.getDate(), 1);

    // 9:00 PM -> next is 4:10 AM tomorrow
    const at9pm = new Date(2026, 8, 1, 21, 0, 0);
    const nextFrom9pm = getNextScheduledCheckTime(at9pm);
    assert.equal(nextFrom9pm.getHours(), 4);
    assert.equal(nextFrom9pm.getMinutes(), 10);
    assert.equal(nextFrom9pm.getDate(), 2);
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
