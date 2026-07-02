import assert from "node:assert/strict";
import test from "node:test";
import {
  inferVolumeItemSpecific,
  parseMissingItemSpecificNames,
} from "@/lib/item-specifics";

test("inferVolumeItemSpecific prefers metric volume when both ml and oz are present", () => {
  assert.equal(
    inferVolumeItemSpecific("Owala FreeSip Water Bottle - 946ml (32oz)"),
    "946 ml"
  );
});

test("inferVolumeItemSpecific reads ounce-only volume", () => {
  assert.equal(inferVolumeItemSpecific("Insulated bottle 32 oz"), "32 oz");
});

test("inferVolumeItemSpecific returns null when no volume is present", () => {
  assert.equal(inferVolumeItemSpecific("Insulated stainless steel bottle"), null);
});

test("parseMissingItemSpecificNames extracts missing eBay specifics", () => {
  assert.deepEqual(
    parseMissingItemSpecificNames(
      "The item specific Volume is missing.; The item specific Volume is missing. Add Volume to this listing, enter a valid value, and then try again.; Volume"
    ),
    ["Volume"]
  );
});
