import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEbayMarketingHeaders,
  EBAY_MARKETPLACE_ID,
  resolveEbayPromotedBidPercentage,
} from "./ebay-marketing";

test("eBay Marketing requests always identify the Australian marketplace", () => {
  const headers = buildEbayMarketingHeaders("test-token", {
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
  });

  assert.equal(headers.Authorization, "Bearer test-token");
  assert.equal(headers["X-EBAY-C-MARKETPLACE-ID"], EBAY_MARKETPLACE_ID);
  assert.equal(headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_AU");
});

test("listing ad rate takes priority over the campaign default", () => {
  assert.equal(resolveEbayPromotedBidPercentage("FIXED", 3, 9), 3);
  assert.equal(resolveEbayPromotedBidPercentage("FIXED", null, 9), 9);
});

test("dynamic and unknown campaigns do not expose a fixed bid percentage", () => {
  assert.equal(resolveEbayPromotedBidPercentage("DYNAMIC", 3, 9), null);
  assert.equal(resolveEbayPromotedBidPercentage("UNKNOWN", 3, 9), null);
});
