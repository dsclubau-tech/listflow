import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MPN,
  getListingItemSpecifics,
  parseMissingItemSpecificNames,
  sanitizeEbayItemSpecifics,
} from "@/lib/item-specifics";

test("sanitizeEbayItemSpecifics removes noisy Amazon script values", () => {
  const sanitized = sanitizeEbayItemSpecifics({
    Brand: "BOTSLAB",
    Features: '(function(f){var _np=(window.P.namespace("DetailPageProductOverview"))})',
    "Special feature":
      'function(f){var _np=(window.P._namespace("DetailPageProductOverviewTemplatesJava"))}',
    "Other Special Features of the Product":
      "Aroma Functions>650W/55KPa Upgraded Powerful Suction>Flex Hose>Mattress Brush",
    "Model Number": "G980H 4 Channel Kit",
  });

  assert.equal("Features" in sanitized, false);
  assert.equal("Special feature" in sanitized, false);
  assert.equal("Other Special Features of the Product" in sanitized, false);
  assert.equal(sanitized.Brand, "BOTSLAB");
  assert.equal(sanitized.Model, "G980H 4 Channel Kit");
});

test("getListingItemSpecifics keeps essential fields before lower-priority details", () => {
  const specifics = getListingItemSpecifics(
    {
      "Battery Life": "70 minutes",
      Runtime: "1 hour and 10 minutes",
      "Filter Type": "HEPA Filter",
      Brand: "SMOTURE",
      Type: "Vacuum Cleaner",
      MPN: DEFAULT_MPN,
      Model: "VAC01",
      Material: "Plastic",
    },
    "Other",
    4
  );

  assert.deepEqual(Object.keys(specifics), ["Brand", "Type", "MPN", "Model"]);
});

test("getListingItemSpecifics preserves useful required identifiers", () => {
  const specifics = getListingItemSpecifics(
    {
      Brand: "BOTSLAB",
      "Manufacturer Part Number": "G980H 4 Channel Kit",
      MPN: DEFAULT_MPN,
      Type: "Dash Camera",
    },
    "Other"
  );

  assert.equal(specifics["Manufacturer Part Number"], "G980H 4 Channel Kit");
  assert.equal(specifics.Brand, "BOTSLAB");
  assert.equal(specifics.Type, "Dash Camera");
});

test("parseMissingItemSpecificNames returns clean missing specifics", () => {
  assert.deepEqual(
    parseMissingItemSpecificNames(
      "The item specific Manufacturer Part Number is missing. Add Manufacturer Part Number to this listing, enter a valid value, and then try again."
    ),
    ["Manufacturer Part Number"]
  );
});
