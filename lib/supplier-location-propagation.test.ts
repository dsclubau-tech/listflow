import assert from "node:assert/strict";
import test from "node:test";
import { applyLocationToDraftSpecifics, isUnpublishedDraftLocationTarget } from "@/lib/supplier-location-propagation";
import { resolveEbayLocationMetadata } from "@/lib/ebay-location";

test("settings location changes target unpublished drafts and failed drafts only", () => {
  assert.equal(isUnpublishedDraftLocationTarget({ status: "DRAFT", ebayItemId: null, activeUpload: false }), true);
  assert.equal(isUnpublishedDraftLocationTarget({ status: "FAILED", ebayItemId: null, activeUpload: false }), true);
  assert.equal(isUnpublishedDraftLocationTarget({ status: "FAILED", ebayItemId: "123", activeUpload: false }), false);
  assert.equal(isUnpublishedDraftLocationTarget({ status: "IMPORTED", ebayItemId: "123", activeUpload: false }), false);
  assert.equal(isUnpublishedDraftLocationTarget({ status: "DRAFT", ebayItemId: null, activeUpload: true }), false);
});

test("location propagation preserves other item specifics and exact suburb", () => {
  const location = resolveEbayLocationMetadata({
    country: "Australia", postalCode: "3175", location: "Dandenong North, VIC",
  });
  const result = applyLocationToDraftSpecifics(
    { Brand: "Acme", Colour: "Blue", _Location: "Bangholme, VIC", _PostalCode: "3175" },
    location,
  );
  assert.deepEqual(result, {
    Brand: "Acme", Colour: "Blue",
    _Country: "AU", _Currency: "AUD", _Location: "Dandenong North, VIC",
    _PostalCode: "3175", _Site: "Australia",
  });
});
