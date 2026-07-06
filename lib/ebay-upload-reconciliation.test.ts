import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDuplicateListingItemId,
  isDuplicateListingError,
} from "./ebay-upload-reconciliation";

test("detects duplicate listing errors from eBay", () => {
  assert.equal(
    isDuplicateListingError(
      "Listing violates the Duplicate Listing policy. It looks like this listing is for an item you already have on eBay.",
    ),
    true,
  );
});

test("extracts eBay item id from duplicate listing message", () => {
  const message =
    "It looks like this listing is for an item you already have on eBay: 4Pcs Memory Foam Wedge Pillow Set Post Surgery Pillow (307044824480).";

  assert.equal(extractDuplicateListingItemId(message), "307044824480");
});

test("does not extract unrelated numbers from non-duplicate errors", () => {
  assert.equal(
    extractDuplicateListingItemId("The item specific Size is missing. Error 21919303."),
    null,
  );
});
