import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEbayLocationMetadata,
  getEbayCountryLabel,
  getZipcodeLocationText,
  resolveEbayLocationMetadata,
  searchAuPostcodes,
  validateAuPostcodeLocation,
} from "@/lib/ebay-location";

test("resolves AU supplier postcode to eBay-safe location metadata", () => {
  const metadata = resolveEbayLocationMetadata({
    country: "Australia",
    postalCode: "3170",
    location: "Mulgrave, VIC",
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
    { country: "Australia", postalCode: "3170", location: "Mulgrave, VIC" },
  );

  assert.equal(specifics.Brand, "Test Brand");
  assert.equal(specifics._Country, "AU");
  assert.equal(specifics._Location, "Mulgrave, VIC");
  assert.equal(specifics._PostalCode, "3170");
});

test("country labels and postcode display use the same mapping as eBay metadata", () => {
  assert.equal(getEbayCountryLabel("AU"), "Australia");
  assert.equal(getZipcodeLocationText("3170", "Australia"), "");
  assert.equal(getZipcodeLocationText("3170", "Australia", "Mulgrave, VIC"), "Mulgrave, VIC");
  assert.equal(getZipcodeLocationText("2217", "Australia"), "");
});

test("searchAuPostcodes returns postcode and suburb suggestions by number or name", () => {
  const byNumber = searchAuPostcodes("2217");
  assert.ok(byNumber.some((s) => s.postcode === "2217" && s.allSuburbs.includes("Kogarah")));

  const byName = searchAuPostcodes("Kogarah");
  assert.ok(byName.some((s) => s.postcode === "2217" && s.suburb === "Kogarah"));
});

test("resolves preferred suburb when multiple suburbs share a postcode (e.g. 2153 Bella Vista vs Baulkham Hills)", () => {
  // Ambiguous postcodes require a selected suburb.
  assert.equal(getZipcodeLocationText("2153", "Australia"), "");

  // With preferred suburb name
  assert.equal(getZipcodeLocationText("2153", "Australia", "Bella Vista"), "Bella Vista, NSW");
  assert.equal(getZipcodeLocationText("2153", "Australia", "Bella Vista, NSW"), "Bella Vista, NSW");
  assert.equal(getZipcodeLocationText("2153", "Australia", "Norwest"), "Norwest, NSW");

  // resolveEbayLocationMetadata preserves selected location
  const metadata = resolveEbayLocationMetadata({
    country: "AU",
    location: "Bella Vista, NSW",
    postalCode: "2153",
  });
  assert.equal(metadata.location, "Bella Vista, NSW");
  assert.equal(metadata.postalCode, "2153");
  assert.equal(metadata.country, "AU");
});


test("3175 keeps Dandenong North distinct from Dandenong and Bangholme", () => {
  assert.equal(getZipcodeLocationText("3175", "Australia"), "");
  assert.equal(getZipcodeLocationText("3175", "Australia", "Dandenong North, VIC"), "Dandenong North, VIC");
  assert.equal(getZipcodeLocationText("3175", "Australia", "Dandenong, VIC"), "Dandenong, VIC");
  assert.equal(validateAuPostcodeLocation("3175", "Australia", "Dandenong North, VIC"), null);
  assert.match(validateAuPostcodeLocation("3175", "Australia", "Dandenong Northland, VIC") ?? "", /Select a suburb/);
  assert.match(validateAuPostcodeLocation("3175", "Australia", null) ?? "", /Select a suburb/);
  assert.match(validateAuPostcodeLocation("3170", "Australia", "Dandenong North, VIC") ?? "", /Select a suburb/);
});
