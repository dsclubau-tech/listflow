import assert from "node:assert/strict";
import test from "node:test";
import {
  getPromotedListingJobQueueError,
  normalizePromotedAdRate,
  normalizePromotedCampaignInput,
  normalizePromotedListingProductIds,
  PROMOTED_LISTING_JOB_ENUM_NOT_READY_MESSAGE,
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

test("maps missing promoted action enum errors to an actionable 503", () => {
  const error = new Error(
    'Invalid `prisma.ebayActionJob.create()` invocation: Invalid input value: invalid input value for enum "EbayActionJobType": "MANAGE_PROMOTED_ADS"',
  );

  assert.deepEqual(getPromotedListingJobQueueError(error), {
    status: 503,
    message: PROMOTED_LISTING_JOB_ENUM_NOT_READY_MESSAGE,
  });
});

test("does not remap unrelated promotion queue errors", () => {
  assert.equal(
    getPromotedListingJobQueueError(new Error("Worker offline")),
    null,
  );
});
