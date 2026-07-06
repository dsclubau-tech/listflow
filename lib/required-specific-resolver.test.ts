import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequiredItemSpecifics } from "@/lib/required-specific-resolver";

test("resolveRequiredItemSpecifics autofills Brand, Type, and neutral Size", () => {
  const result = resolveRequiredItemSpecifics({
    title: "4Pcs Memory Foam Wedge Pillow Set Post Surgery",
    categoryName: "Bed Wedge Pillows",
    brand: "Luxdream",
    itemSpecifics: {
      "Brand Name": "Luxdream",
      MPN: "Does not apply",
    },
    requiredItemSpecifics: [
      { name: "Size", values: ["Small", "Medium", "One Size"] },
      { name: "Type", values: ["Bed Wedge Pillow", "Bolster", "Pillow"] },
      { name: "Brand", values: ["Luxdream", "Unbranded"] },
    ],
  });

  assert.equal(result.itemSpecifics.Size, "One Size");
  assert.equal(result.itemSpecifics.Type, "Bed Wedge Pillow");
  assert.equal(result.itemSpecifics.Brand, "Luxdream");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((decision) => decision.name === "Size")?.source,
    "ebay_allowed_default",
  );
});

test("resolveRequiredItemSpecifics preserves user-entered required values", () => {
  const result = resolveRequiredItemSpecifics({
    title: "4Pcs Memory Foam Wedge Pillow Set Post Surgery",
    categoryName: "Bed Wedge Pillows",
    brand: "Luxdream",
    itemSpecifics: {
      Size: "Large",
      Type: "Pillow",
      Brand: "User Brand",
    },
    requiredItemSpecifics: [
      { name: "Size", values: ["Large", "One Size"] },
      { name: "Type", values: ["Bed Wedge Pillow", "Pillow"] },
      { name: "Brand", values: ["User Brand", "Luxdream"] },
    ],
  });

  assert.equal(result.itemSpecifics.Size, "Large");
  assert.equal(result.itemSpecifics.Type, "Pillow");
  assert.equal(result.itemSpecifics.Brand, "User Brand");
  assert.deepEqual(
    result.decisions.map((decision) => decision.source),
    ["user", "user", "user"],
  );
});

test("resolveRequiredItemSpecifics blocks missing unsafe size guesses", () => {
  const result = resolveRequiredItemSpecifics({
    title: "4Pcs Memory Foam Wedge Pillow Set Post Surgery",
    categoryName: "Bed Wedge Pillows",
    brand: "Luxdream",
    itemSpecifics: {
      Brand: "Luxdream",
    },
    requiredItemSpecifics: [
      { name: "Size", values: ["Small", "Medium", "Large"] },
      { name: "Brand", values: ["Luxdream"] },
    ],
  });

  assert.equal(result.itemSpecifics.Size, undefined);
  assert.deepEqual(result.missingItemSpecifics, ["Size"]);
});
