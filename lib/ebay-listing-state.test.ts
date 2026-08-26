import assert from "node:assert/strict";
import test from "node:test";
import { hasRevisableEbayListing } from "@/lib/ebay-listing-state";

test("imported and on-hold products with an eBay Item ID are revisable", () => {
  assert.equal(
    hasRevisableEbayListing({ status: "IMPORTED", ebayItemId: "123" }),
    true,
  );
  assert.equal(
    hasRevisableEbayListing({ status: "ON_HOLD", ebayItemId: "123" }),
    true,
  );
});

test("draft, failed, and unlinked products are not revisable", () => {
  assert.equal(
    hasRevisableEbayListing({ status: "DRAFT", ebayItemId: "123" }),
    false,
  );
  assert.equal(
    hasRevisableEbayListing({ status: "FAILED", ebayItemId: "123" }),
    false,
  );
  assert.equal(
    hasRevisableEbayListing({ status: "IMPORTED", ebayItemId: null }),
    false,
  );
  assert.equal(
    hasRevisableEbayListing({ status: "ON_HOLD", ebayItemId: "  " }),
    false,
  );
});
