import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright-core";
import { scrapeAmazonPrice } from "./amazon-scraper";
import { PriceCheckFailure } from "./price-check-failures";
import { createAmazonDeliveryStateSession } from "./amazon-delivery-state";

for (const reuseDeliveryState of [false, true]) {
  test(`wrong delivery postcode rejects the check with delivery reuse ${reuseDeliveryState ? "enabled" : "disabled"}`, async () => {
    let contextClosed = false;
    let priceReadAttempted = false;
    const page = {
      route: async () => {},
      addInitScript: async () => {},
      goto: async () => {},
      content: async () => '<div id="glow-ingress-line2">Sydney 2000</div>',
      evaluate: async (_fn: unknown, argument?: unknown) => argument
        ? { success: true, responseText: '{"isValidAddress":1}' }
        : "Sydney 2000",
      waitForFunction: async () => { throw new Error("Location never changed"); },
      waitForSelector: async () => { priceReadAttempted = true; },
    };
    const browser = {
      newContext: async () => ({
        newPage: async () => page,
        close: async () => { contextClosed = true; },
      }),
    } as unknown as Browser;

    await assert.rejects(
      scrapeAmazonPrice("B0G6CQ427S", browser, "2217", "REGULAR", null,
        reuseDeliveryState ? { deliveryState: createAmazonDeliveryStateSession("2217") } : undefined),
      (error: unknown) => error instanceof PriceCheckFailure &&
        error.code === "TECHNICAL_ERROR" && /postcode 2217/.test(error.message),
    );
    assert.equal(priceReadAttempted, false);
    assert.equal(contextClosed, true);
  });
}
