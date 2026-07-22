import assert from "node:assert/strict";
import test from "node:test";
import {
  addPackageDimensionItemSpecifics,
  extractPackageDimensions,
  parsePackageDimensionValue,
  parsePackageWeight,
} from "@/lib/amazon-package-dimensions";

test("parsePackageWeight reads kilograms as kg and grams", () => {
  assert.deepEqual(parsePackageWeight("1.2 kg"), {
    totalGrams: 1200,
    convertedUnits: [],
  });
});

test("parsePackageWeight reads grams", () => {
  assert.deepEqual(parsePackageWeight("500 grams"), {
    totalGrams: 500,
    convertedUnits: [],
  });
});

test("parsePackageWeight converts pounds to grams", () => {
  assert.deepEqual(parsePackageWeight("2 pounds"), {
    totalGrams: 907.185,
    convertedUnits: ["lb"],
  });
});

test("parsePackageWeight returns null when missing", () => {
  assert.equal(parsePackageWeight("not supplied"), null);
});

test("parsePackageDimensionValue reads centimetres", () => {
  assert.deepEqual(parsePackageDimensionValue("30 x 20 x 10 cm"), {
    lengthCm: 30,
    widthCm: 20,
    heightCm: 10,
    convertedUnits: [],
  });
});

test("parsePackageDimensionValue converts inches to centimetres", () => {
  assert.deepEqual(parsePackageDimensionValue("12 x 8 x 4 inches"), {
    lengthCm: 30.48,
    widthCm: 20.32,
    heightCm: 10.16,
    convertedUnits: ["in"],
  });
});

test("parsePackageDimensionValue returns null when missing", () => {
  assert.equal(parsePackageDimensionValue("not supplied"), null);
});

test("extractPackageDimensions reads mixed Amazon package fields", () => {
  assert.deepEqual(
    extractPackageDimensions({
      "Package Weight": "2 pounds",
      "Product Dimensions": "12 x 8 x 4 inches",
    }),
    {
      weightKg: 0,
      weightG: 908,
      lengthCm: 30.48,
      widthCm: 20.32,
      heightCm: 10.16,
      convertedUnits: ["lb", "in"],
    },
  );
});

test("extractPackageDimensions reads inline weight from a dimensions row", () => {
  assert.deepEqual(
    extractPackageDimensions({
      "Product Dimensions": "12 x 8 x 4 inches; 2 pounds",
    }),
    {
      weightKg: 0,
      weightG: 908,
      lengthCm: 30.48,
      widthCm: 20.32,
      heightCm: 10.16,
      convertedUnits: ["in", "lb"],
    },
  );
});

test("extractPackageDimensions reads separate Amazon item dimension fields", () => {
  assert.deepEqual(
    extractPackageDimensions({
      "Item Weight": "181 Grams",
      "Item Length": "12.5 cm",
      "Item Width": "8.5 cm",
      "Item Height": "2.5 cm",
    }),
    {
      weightKg: 0,
      weightG: 181,
      lengthCm: 12.5,
      widthCm: 8.5,
      heightCm: 2.5,
      convertedUnits: [],
    },
  );
});

test("extractPackageDimensions prefers explicit package fields over item fields", () => {
  assert.deepEqual(
    extractPackageDimensions({
      "Item Dimensions L x W x H": "40 x 30 x 20 cm",
      "Package Dimensions": "20 x 10 x 5 cm",
    }),
    {
      lengthCm: 20,
      widthCm: 10,
      heightCm: 5,
      convertedUnits: [],
    },
  );
});

test("extractPackageDimensions converts separate imperial dimensions", () => {
  assert.deepEqual(
    extractPackageDimensions({
      "Package Length": "12 in",
      "Package Width": "8 in",
      "Package Height": "4 in",
    }),
    {
      lengthCm: 30.48,
      widthCm: 20.32,
      heightCm: 10.16,
      convertedUnits: ["in"],
    },
  );
});

test("addPackageDimensionItemSpecifics stores hidden eBay package keys", () => {
  assert.deepEqual(
    addPackageDimensionItemSpecifics(
      { Brand: "Test" },
      {
        weightKg: 1,
        weightG: 200,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
        convertedUnits: [],
      },
    ),
    {
      Brand: "Test",
      _WeightKg: "1",
      _WeightG: "200",
      _LengthCm: "30",
      _WidthCm: "20",
      _HeightCm: "10",
    },
  );
});
