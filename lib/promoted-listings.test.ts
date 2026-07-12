import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePromotedAdRate,
  normalizePromotedCampaignInput,
  normalizePromotedListingProductIds,
} from "./promoted-listings";

test("accepts fixed eBay ad rates from 2.0 to 100.0 with one decimal", () => {
  assert.equal(normalizePromotedAdRate("2.0"), 2);
  assert.equal(normalizePromotedAdRate(3.5), 3.5);
  assert.equal(normalizePromotedAdRate("100.0"), 100);
});

test("rejects out-of-range and over-precise eBay ad rates", () => {
  assert.equal(normalizePromotedAdRate(1.9), null);
  assert.equal(normalizePromotedAdRate(100.1), null);
  assert.equal(normalizePromotedAdRate(3.55), null);
  assert.equal(normalizePromotedAdRate("not-a-rate"), null);
});

test("normalizes and deduplicates selected product IDs", () => {
  assert.deepEqual(
    normalizePromotedListingProductIds([" product-1 ", "product-1", "", 2]),
    ["product-1"],
  );
});

test("requires a valid existing campaign or a named new campaign", () => {
  assert.deepEqual(
    normalizePromotedCampaignInput({ mode: "EXISTING", campaignId: " 123 " }),
    { mode: "EXISTING", campaignId: "123", campaignName: "" },
  );
  assert.deepEqual(
    normalizePromotedCampaignInput({ mode: "CREATE", campaignName: " ListFlow " }),
    { mode: "CREATE", campaignId: "", campaignName: "ListFlow" },
  );
  assert.equal(
    normalizePromotedCampaignInput({ mode: "CREATE", campaignName: "" }),
    null,
  );
  assert.equal(
    normalizePromotedCampaignInput({ mode: "EXISTING", campaignId: "" }),
    null,
  );
});
