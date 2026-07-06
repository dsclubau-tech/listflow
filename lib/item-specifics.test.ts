import assert from "node:assert/strict";
import test from "node:test";
import {
  inferBrandItemSpecific,
  inferSizeItemSpecific,
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

test("inferBrandItemSpecific reads brand name over placeholder brand", () => {
  assert.equal(
    inferBrandItemSpecific({
      itemSpecifics: {
        Brand: "Unbranded",
        "Brand Name": "BOTSLAB",
      },
    }),
    "BOTSLAB"
  );
});

test("inferBrandItemSpecific preserves real user brand first", () => {
  assert.equal(
    inferBrandItemSpecific({
      brand: "Owalla",
      itemSpecifics: {
        "Brand Name": "Owala",
      },
    }),
    "Owalla"
  );
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

test("inferTypeItemSpecific reads foot massager type from title", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Foot Massager Machine with Heat, Deep Kneading for Feet",
      allowedValues: ["Foot Massager", "Massage Chair", "Other"],
    }),
    "Foot Massager"
  );
});

test("inferTypeItemSpecific falls back to allowed massager type", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Foot Massager Machine with Heat, Deep Kneading for Feet",
      allowedValues: ["Massager", "Massage Chair", "Other"],
    }),
    "Massager"
  );
});

test("inferTypeItemSpecific reads earbud type from headphone products", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "SOUNDPEATS PearlClip Pro Ear Clip Earbuds, Open-Ear Wireless Earphones",
      categoryName: "Electronics > Portable Audio & Headphones > Headphones",
      itemSpecifics: {
        Brand: "SoundPEATS",
        "Form factor": "Clip-On",
        Connectivity: "Wireless",
      },
      allowedValues: ["Earbud (In Ear)", "Headphones", "Headset", "Other"],
    }),
    "Earbud (In Ear)"
  );
});

test("inferTypeItemSpecific uses broad headphone type when specific earbud value is unavailable", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "SOUNDPEATS PearlClip Pro Ear Clip Earbuds, Open-Ear Wireless Earphones",
      categoryName: "Electronics > Portable Audio & Headphones > Headphones",
      itemSpecifics: {
        "Form factor": "Clip-On",
      },
      allowedValues: ["Headphones", "Headset", "Other"],
    }),
    "Headphones"
  );
});

test("inferTypeItemSpecific reads Amazon form factor when eBay allows it", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Wireless audio accessory",
      itemSpecifics: {
        "Form factor": "Clip-On",
      },
      allowedValues: ["Earbud (In Ear)", "Clip-On", "Headphones", "Other"],
    }),
    "Clip-On"
  );
});

test("inferTypeItemSpecific matches visible eBay allowed type before Other", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Stainless Steel Air Fryer Basket with Handle",
      categoryName: "Home & Garden > Kitchen Appliances > Air Fryers",
      allowedValues: ["Deep Fryer", "Air Fryer", "Other"],
    }),
    "Air Fryer"
  );
});

test("inferTypeItemSpecific uses Other only when eBay allows no better type", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "Universal household accessory organizer",
      allowedValues: ["Belt", "Hat", "Other"],
    }),
    "Other"
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

test("inferTypeItemSpecific reads bed wedge pillow type when allowed", () => {
  assert.equal(
    inferTypeItemSpecific({
      title: "4PCS Orthopedic Bed Wedge Pillow, Adjustable Cushion",
      allowedValues: ["Mattress Protector", "Wedge Pillow", "Bolster"],
    }),
    "Wedge Pillow"
  );
});

test("inferSizeItemSpecific reads direct Amazon size when allowed", () => {
  assert.equal(
    inferSizeItemSpecific({
      itemSpecifics: { "Size Name": "Queen" },
      allowedValues: ["Single", "Double", "Queen", "King"],
    }),
    "Queen"
  );
});

test("inferSizeItemSpecific reads dimensions when no allowed values are provided", () => {
  assert.equal(
    inferSizeItemSpecific({
      itemSpecifics: {
        "Item Dimensions L x W x H": "30L x 20W x 10H centimetres",
      },
    }),
    "30L x 20W x 10H centimetres"
  );
});

test("inferSizeItemSpecific does not guess product count as size", () => {
  assert.equal(
    inferSizeItemSpecific({
      title: "4PCS Orthopedic Bed Wedge Pillow, Adjustable Cushion",
      allowedValues: ["Small", "Medium", "Large"],
    }),
    null
  );
});

test("inferSizeItemSpecific uses neutral allowed size for single-size products", () => {
  assert.equal(
    inferSizeItemSpecific({
      title: "4Pcs Memory Foam Wedge Pillow Set Post Surgery",
      categoryName: "Bed Wedge Pillows",
      allowedValues: ["Small", "Medium", "One Size"],
    }),
    "One Size"
  );
});

test("inferSizeItemSpecific only uses count as size when eBay allows it", () => {
  assert.equal(
    inferSizeItemSpecific({
      title: "4Pcs Memory Foam Wedge Pillow Set Post Surgery",
      categoryName: "Bed Wedge Pillows",
      allowedValues: ["Set of 4", "Set of 6"],
    }),
    "Set of 4"
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
