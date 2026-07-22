import assert from "node:assert/strict";
import test from "node:test";

import {
  extractEbayPackageDimensions,
  fillMissingEbayPackageItemSpecifics,
} from "./ebay-package-details";

test("extractEbayPackageDimensions reads metric package data", () => {
  assert.deepEqual(
    extractEbayPackageDimensions({
      ShippingPackageDetails: {
        MeasurementUnit: "Metric",
        WeightMajor: "0",
        WeightMinor: "181",
        PackageLength: "13",
        PackageWidth: "9",
        PackageDepth: "3",
      },
    }),
    {
      weightKg: 0,
      weightG: 181,
      lengthCm: 13,
      widthCm: 9,
      heightCm: 3,
      convertedUnits: [],
    },
  );
});

test("extractEbayPackageDimensions converts English package data", () => {
  assert.deepEqual(
    extractEbayPackageDimensions({
      MeasurementUnit: "English",
      WeightMajor: "2",
      WeightMinor: "0",
      PackageLength: "12",
      PackageWidth: "8",
      PackageDepth: "4",
    }),
    {
      weightKg: 0,
      weightG: 908,
      lengthCm: 30.48,
      widthCm: 20.32,
      heightCm: 10.16,
      convertedUnits: ["lb", "oz", "in"],
    },
  );
});

test("fillMissingEbayPackageItemSpecifics preserves existing Amazon package values", () => {
  assert.deepEqual(
    fillMissingEbayPackageItemSpecifics(
      { _WeightKg: "1", _WeightG: "200", Brand: "Test" },
      {
        ShippingPackageDetails: {
          MeasurementUnit: "Metric",
          WeightMajor: "0",
          WeightMinor: "181",
          PackageLength: "13",
          PackageWidth: "9",
          PackageDepth: "3",
        },
      },
    ),
    {
      _WeightKg: "1",
      _WeightG: "200",
      _LengthCm: "13",
      _WidthCm: "9",
      _HeightCm: "3",
      Brand: "Test",
    },
  );
});
