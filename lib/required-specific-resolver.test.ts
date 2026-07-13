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

test("resolveRequiredItemSpecifics autofills headphone Type from Amazon specifics", () => {
  const result = resolveRequiredItemSpecifics({
    title: "SOUNDPEATS PearlClip Pro Ear Clip Earbuds, Open-Ear Wireless Earphones",
    categoryName: "Electronics > Portable Audio & Headphones > Headphones",
    brand: "SoundPEATS",
    itemSpecifics: {
      Brand: "SoundPEATS",
      "Form factor": "Clip-On",
      Connectivity: "Wireless",
      MPN: "Does not apply",
    },
    requiredItemSpecifics: [
      { name: "Type", values: ["Earbud (In Ear)", "Headphones", "Headset", "Other"] },
      { name: "Brand", values: ["SoundPEATS", "Unbranded"] },
    ],
  });

  assert.equal(result.itemSpecifics.Type, "Earbud (In Ear)");
  assert.equal(result.itemSpecifics.Brand, "SoundPEATS");
  assert.deepEqual(result.missingItemSpecifics, []);
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

test("resolveRequiredItemSpecifics infers Compatible Brand from product Brand", () => {
  const result = resolveRequiredItemSpecifics({
    title: "BRITA MAXTRA PRO Limescale Expert Water Filter Cartridges",
    categoryName: "Water Filter Cartridges",
    brand: "BRITA",
    itemSpecifics: {
      Brand: "BRITA",
      Model: "Maxtra Pro LS",
    },
    requiredItemSpecifics: [
      { name: "Compatible Brand", values: ["BRITA", "Brita", "PUR", "Unbranded"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Brand"], "BRITA");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Brand")?.source,
    "amazon",
  );
});

test("resolveRequiredItemSpecifics infers Compatible Model from Amazon item specifics", () => {
  const result = resolveRequiredItemSpecifics({
    title: "BRITA MAXTRA PRO Limescale Expert Water Filter Cartridges",
    categoryName: "Water Filter Cartridges",
    brand: "BRITA",
    itemSpecifics: {
      Brand: "BRITA",
      "Compatible Model": "Maxtra Pro",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["Maxtra", "Maxtra Pro", "Maxtra+", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "Maxtra Pro");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Model")?.source,
    "user",
  );
});

test("resolveRequiredItemSpecifics infers Compatible Model from product Model field", () => {
  const result = resolveRequiredItemSpecifics({
    title: "BRITA MAXTRA PRO Limescale Expert Water Filter Cartridges",
    categoryName: "Water Filter Cartridges",
    brand: "BRITA",
    itemSpecifics: {
      Brand: "BRITA",
      Model: "Maxtra Pro LS",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["Maxtra", "Maxtra Pro", "Maxtra+", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "Maxtra");
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("resolveRequiredItemSpecifics infers Compatible Model from title", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Replacement Filter for Dyson Pure Cool TP02",
    categoryName: "Air Purifier Filters",
    brand: "Dyson",
    itemSpecifics: {
      Brand: "Dyson",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["Pure Cool TP02", "Pure Cool TP04", "Pure Hot+Cool"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "Pure Cool TP02");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Model")?.source,
    "title",
  );
});

test("resolveRequiredItemSpecifics reports Compatible Model missing when no data matches", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Generic Water Filter Cartridge",
    categoryName: "Water Filter Cartridges",
    brand: "Generic",
    itemSpecifics: {
      Brand: "Generic",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["Maxtra", "Maxtra Pro", "Maxtra+"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], undefined);
  assert.deepEqual(result.missingItemSpecifics, ["Compatible Model"]);
});
