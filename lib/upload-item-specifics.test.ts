import assert from "node:assert/strict";
import test from "node:test";
import {
  getRequiredItemSpecificsForMissingNames,
  resolveMissingItemSpecificsForUploadRetry,
  shouldBlockUploadForRequiredSpecificsPreflight,
} from "@/lib/upload-item-specifics";

test("Taxonomy-only missing specifics do not block the first AddItem attempt", () => {
  assert.equal(
    shouldBlockUploadForRequiredSpecificsPreflight({
      missingItemSpecifics: ["Stove Type Compatibility"],
    }),
    false,
  );
});

test("getRequiredItemSpecificsForMissingNames preserves known eBay values", () => {
  const result = getRequiredItemSpecificsForMissingNames(
    ["Stove Type Compatibility", "Brand"],
    [
      { name: "Brand", values: ["AMVR", "Unbranded"] },
      {
        name: "Stove Type Compatibility",
        values: ["Gas", "Electric", "Induction"],
      },
    ],
  );

  assert.deepEqual(result, [
    {
      name: "Stove Type Compatibility",
      values: ["Gas", "Electric", "Induction"],
    },
    { name: "Brand", values: ["AMVR", "Unbranded"] },
  ]);
});

test("eBay missing Brand triggers an autofill-and-retry attempt when possible", () => {
  const result = resolveMissingItemSpecificsForUploadRetry({
    title: "AMVR RGB Charging Dock Compatible with Meta Quest 3",
    brand: "Unbranded",
    itemSpecifics: { Brand: "Unbranded" },
    missingItemSpecifics: ["Brand"],
    requiredItemSpecifics: [
      { name: "Brand", values: ["AMVR", "Unbranded"] },
    ],
  });

  assert.equal(result.shouldRetry, true);
  assert.equal(result.itemSpecifics.Brand, "AMVR");
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("eBay missing specifics stay unresolved when retry autofill cannot fill them", () => {
  const result = resolveMissingItemSpecificsForUploadRetry({
    title: "5 Pcs Pots and Pans Set Non Stick, Ceramic Cookware",
    categoryName: "Cookware Sets",
    itemSpecifics: { Material: "Ceramic" },
    missingItemSpecifics: ["Stove Type Compatibility"],
    requiredItemSpecifics: [
      {
        name: "Stove Type Compatibility",
        values: ["Gas", "Electric", "Induction"],
      },
    ],
  });

  assert.equal(result.shouldRetry, false);
  assert.deepEqual(result.missingItemSpecifics, ["Stove Type Compatibility"]);
});
