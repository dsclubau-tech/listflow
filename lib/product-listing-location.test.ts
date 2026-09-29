import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductListingLocation } from "./product-listing-location";

const defaults = {
  defaultCountry: "Australia", defaultZipcode: "3175", defaultLocationText: "Dandenong North, VIC",
};

test("postcode-only legacy imports use the authenticated store's matching suburb", () => {
  const result = resolveProductListingLocation({ _Country: "AU", _PostalCode: "3175", _Location: "3175", Brand: "Example" }, defaults);
  assert.equal(result.error, null);
  assert.equal(result.specifics._Location, "Dandenong North, VIC");
  assert.equal(result.specifics._PostalCode, "3175");
  assert.equal(result.specifics.Brand, "Example");
});

test("explicit valid listing locality is preserved", () => {
  const result = resolveProductListingLocation({ _Country: "AU", _PostalCode: "3175", _Location: "Dandenong, VIC" }, defaults);
  assert.equal(result.specifics._Location, "Dandenong, VIC");
});

test("mismatched explicit suburb and mismatched defaults are rejected", () => {
  assert.equal(resolveProductListingLocation({ _Country: "AU", _PostalCode: "3175", _Location: "Sydney, NSW" }, defaults).code, "LISTING_LOCATION_INVALID");
  assert.equal(resolveProductListingLocation({ _Country: "AU", _PostalCode: "3170", _Location: "3170" }, defaults).code, "LISTING_LOCATION_REQUIRED");
});
