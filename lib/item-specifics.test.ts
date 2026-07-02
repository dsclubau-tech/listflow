import assert from "node:assert/strict";
import test from "node:test";
import {
  inferTypeItemSpecific,
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

test("inferTypeItemSpecific reads telephoto lens type from existing specifics", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "EF/EF-S 420-800mm F8.3 Telephoto Zoom Lens",
      itemSpecifics: {
        Lens: "Telephoto",
        "Lens type": "Telephoto",
      },
      allowedValues: ["Macro", "Telephoto", "Wide Angle"],
    }),
    "Telephoto"
  );
});

test("inferTypeItemSpecific reads USB-C charger type from title", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Prime USB C Charger, 200W 6-Port GaN Charging Station",
      allowedValues: ["Car Charger", "Wall Charger", "Charging Cable"],
    }),
    "Wall Charger"
  );
});

test("inferTypeItemSpecific prefers charging station when eBay allows it", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Prime USB C Charger, 200W 6-Port GaN Charging Station",
      allowedValues: ["Wall Charger", "Charging Station", "Power Bank"],
    }),
    "Charging Station"
  );
});

test("inferTypeItemSpecific does not guess when allowed values do not match", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "EF/EF-S 420-800mm F8.3 Telephoto Zoom Lens",
      allowedValues: ["Tripod", "Filter"],
    }),
    null
  );
});

test("parseMissingItemSpecificNames extracts missing eBay specifics", () => {
  assert.deepEqual(
    parseMissingItemSpecificNames(
      "The item specific Volume is missing.; The item specific Volume is missing. Add Volume to this listing, enter a valid value, and then try again.; Volume"
    ),
    ["Volume"]
  );
});
