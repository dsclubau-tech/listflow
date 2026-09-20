import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "playwright-core";
import {
  canReuseAmazonDeliveryState,
  createAmazonDeliveryStateSession,
  hasExactAmazonDeliveryPostcode,
  resetAmazonDeliveryState,
  seedAmazonDeliveryState,
} from "./amazon-delivery-state";

test("postcode verification requires the exact configured postcode", () => {
  assert.equal(hasExactAmazonDeliveryPostcode("Deliver to Kogarah 2217", "2217"), true);
  assert.equal(hasExactAmazonDeliveryPostcode("Deliver to Sydney 2000", "2217"), false);
  assert.equal(hasExactAmazonDeliveryPostcode("Deliver to Australia", "2217"), false);
  assert.equal(hasExactAmazonDeliveryPostcode("Suburb 12217", "2217"), false);
});

test("delivery state is scoped to the browser and postcode", () => {
  const browser = {} as Browser;
  const otherBrowser = {} as Browser;
  const session = createAmazonDeliveryStateSession("2217");
  seedAmazonDeliveryState(session, {
    browser,
    userAgent: "test-agent",
    storageState: { cookies: [], origins: [] },
  });

  assert.equal(canReuseAmazonDeliveryState(session, browser, "2217"), true);
  assert.equal(canReuseAmazonDeliveryState(session, otherBrowser, "2217"), false);
  assert.equal(canReuseAmazonDeliveryState(session, browser, "2000"), false);
});

test("a verification failure clears and permanently disables the job session", () => {
  const browser = {} as Browser;
  const session = createAmazonDeliveryStateSession("2217");
  seedAmazonDeliveryState(session, {
    browser,
    userAgent: "test-agent",
    storageState: { cookies: [], origins: [] },
  });
  resetAmazonDeliveryState(session, {
    disable: true,
    reason: "wrong postcode",
  });

  assert.equal(session.disabled, true);
  assert.equal(session.storageState, null);
  assert.equal(canReuseAmazonDeliveryState(session, browser, "2217"), false);
  assert.equal(
    seedAmazonDeliveryState(session, {
      browser,
      userAgent: "new-agent",
      storageState: { cookies: [], origins: [] },
    }),
    false,
  );
});
