import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEbayLocationMetadata,
  getEbayCountryLabel,
  getZipcodeLocationText,
  resolveEbayLocationMetadata,
  searchAuPostcodes,
} from "@/lib/ebay-location";

test("resolves AU supplier postcode to eBay-safe location metadata", () => {
  const metadata = resolveEbayLocationMetadata({
    country: "Australia",
    postalCode: "3170",
  });

  assert.deepEqual(metadata, {
    country: "AU",
    currency: "AUD",
    location: "Mulgrave, VIC",
    postalCode: "3170",
    site: "Australia",
  });
});

test("repairs country-only item location using postcode", () => {
  const metadata = resolveEbayLocationMetadata({
    country: "AU",
    location: "Australia",
    postalCode: "3000",
  });

  assert.equal(metadata.location, "Melbourne, VIC");
  assert.equal(metadata.country, "AU");
});

test("applies location metadata while preserving visible item specifics", () => {
  const specifics = applyEbayLocationMetadata(
    { Brand: "Test Brand", _Location: "Australia" },
    { country: "Australia", postalCode: "3170" },
  );

  assert.equal(specifics.Brand, "Test Brand");
  assert.equal(specifics._Country, "AU");
  assert.equal(specifics._Location, "Mulgrave, VIC");
  assert.equal(specifics._PostalCode, "3170");
});

test("country labels and postcode display use the same mapping as eBay metadata", () => {
  assert.equal(getEbayCountryLabel("AU"), "Australia");
  assert.equal(getZipcodeLocationText("3170", "Australia"), "Mulgrave, VIC");
  assert.equal(getZipcodeLocationText("2217", "Australia"), "Beverley Park, NSW");
});

test("searchAuPostcodes returns postcode and suburb suggestions by number or name", () => {
  const byNumber = searchAuPostcodes("2217");
  assert.ok(byNumber.some((s) => s.postcode === "2217" && s.allSuburbs.includes("Kogarah")));

  const byName = searchAuPostcodes("Kogarah");
  assert.ok(byName.some((s) => s.postcode === "2217" && s.suburb === "Kogarah"));
});
