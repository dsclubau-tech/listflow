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

test("resolveRequiredItemSpecifics infers Compatible Brand from a brand named in the title", () => {
  const result = resolveRequiredItemSpecifics({
    title: 'Teamgee 14" Laptop Screen Extender for Dell XPS',
    categoryName: "Laptop Screens & LCD Panels",
    brand: "Teamgee",
    itemSpecifics: { Brand: "Teamgee" },
    requiredItemSpecifics: [
      { name: "Compatible Brand", values: ["For Dell", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Brand"], "For Dell");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Brand")?.source,
    "title",
  );
});

test("resolveRequiredItemSpecifics matches a For Brand compatible option", () => {
  const result = resolveRequiredItemSpecifics({
    title: '14" Laptop Screen Extender',
    categoryName: "Laptop Screens & LCD Panels",
    brand: "Teamgee",
    itemSpecifics: { Brand: "Teamgee" },
    requiredItemSpecifics: [
      { name: "Compatible Brand", values: ["For Teamgee", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Brand"], "For Teamgee");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Brand")?.source,
    "amazon",
  );
});

test("resolveRequiredItemSpecifics uses Universal as the Compatible Brand fallback", () => {
  const result = resolveRequiredItemSpecifics({
    title: 'Teamgee 14" Laptop Screen Extender',
    categoryName: "Laptop Screens & LCD Panels",
    brand: "Teamgee",
    itemSpecifics: { Brand: "Teamgee" },
    requiredItemSpecifics: [
      { name: "Compatible Brand", values: ["For Dell", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Brand"], "Universal");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Brand")?.source,
    "ebay_allowed_default",
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

test("resolveRequiredItemSpecifics reports Compatible Model missing when no data matches and no fallback exists", () => {
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

test("resolveRequiredItemSpecifics falls back to Universal for Compatible Model when no specific data matches", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Shark WandVac 2.0 Cordless Handheld Vacuum Cleaner",
    categoryName: "Vacuum Cleaners",
    brand: "Shark",
    itemSpecifics: {
      Brand: "Shark",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["WV200", "WV201", "WV205", "Universal"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "Universal");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Model")?.source,
    "ebay_allowed_default",
  );
});

test("resolveRequiredItemSpecifics falls back to Does Not Apply for Compatible Model when no specific data matches", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Shark WandVac 2.0 Cordless Handheld Vacuum Cleaner",
    categoryName: "Vacuum Cleaners",
    brand: "Shark",
    itemSpecifics: {
      Brand: "Shark",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["WV200", "WV201", "Does Not Apply"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "Does Not Apply");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Model")?.source,
    "ebay_allowed_default",
  );
});

test("resolveRequiredItemSpecifics matches For Brand Model pattern for Compatible Model", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Shark WandVac Cordless Handheld Vacuum Cleaner",
    categoryName: "Vacuum Cleaners",
    brand: "Shark",
    itemSpecifics: {
      Brand: "Shark",
      Model: "WandVac 2.0",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["For Dyson V8", "For Shark WandVac 2.0", "For Roomba 690"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "For Shark WandVac 2.0");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((d) => d.name === "Compatible Model")?.source,
    "amazon",
  );
});

test("resolveRequiredItemSpecifics infers Model from Amazon item specifics and title", () => {
  const result = resolveRequiredItemSpecifics({
    title: "BRITA MAXTRA PRO Limescale Expert Water Filter Cartridges",
    categoryName: "Water Filter Cartridges",
    brand: "BRITA",
    itemSpecifics: {
      Brand: "BRITA",
      "Model Number": "Maxtra Pro Limescale",
    },
    requiredItemSpecifics: [
      { name: "Model", values: ["Maxtra", "Maxtra Pro", "Maxtra+"] },
    ],
  });

  assert.equal(result.itemSpecifics["Model"], "Maxtra");
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("resolveRequiredItemSpecifics matches Maxtra Pro candidate to For Brita Maxtra+ dropdown option", () => {
  const result = resolveRequiredItemSpecifics({
    title: "BRITA MAXTRA PRO Limescale Expert Water Filter Cartridges",
    categoryName: "Water Filter Cartridges",
    brand: "BRITA",
    itemSpecifics: {
      Brand: "BRITA",
      "Compatible Model": "Maxtra Pro",
    },
    requiredItemSpecifics: [
      { name: "Compatible Model", values: ["For Aqua Optima Evolve", "For Brita Maxtra+", "For Samsung Aquarius"] },
    ],
  });

  assert.equal(result.itemSpecifics["Compatible Model"], "For Brita Maxtra+");
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("resolveRequiredItemSpecifics resolves Stove Type Compatibility from Amazon specifics", () => {
  const result = resolveRequiredItemSpecifics({
    title: "5 Pcs Pots and Pans Set Non Stick, Ceramic Cookware",
    categoryName: "Cookware Sets",
    brand: "Generic",
    itemSpecifics: {
      "Heat Source": "Induction, Gas, Electric",
      Material: "Ceramic",
    },
    requiredItemSpecifics: [
      { name: "Stove Type Compatibility", values: ["Gas", "Electric", "Induction", "Ceramic", "Halogen"] },
    ],
  });

  // Should match "Induction" from the Amazon "Heat Source" spec via generic fallback
  assert.ok(
    ["Gas", "Electric", "Induction"].includes(result.itemSpecifics["Stove Type Compatibility"] ?? ""),
    `Expected one of Gas/Electric/Induction but got: ${result.itemSpecifics["Stove Type Compatibility"]}`
  );
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("resolveRequiredItemSpecifics accepts Unbranded when it is the allowed brand fallback", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Replacement Charging Dock Compatible with Meta Quest 3",
    categoryName: "VR Accessories",
    brand: "Unbranded",
    itemSpecifics: { Brand: "Unbranded" },
    requiredItemSpecifics: [
      { name: "Brand", values: ["Unbranded"] },
    ],
  });

  assert.equal(result.itemSpecifics.Brand, "Unbranded");
  assert.deepEqual(result.missingItemSpecifics, []);
  assert.equal(
    result.decisions.find((decision) => decision.name === "Brand")?.source,
    "ebay_allowed_default",
  );
});

test("resolveRequiredItemSpecifics leaves unmatched Stove Type Compatibility unresolved", () => {
  const result = resolveRequiredItemSpecifics({
    title: "5 Pcs Pots and Pans Set Non Stick, Ceramic Cookware",
    categoryName: "Cookware Sets",
    brand: "Generic",
    itemSpecifics: {
      Material: "Ceramic",
    },
    requiredItemSpecifics: [
      { name: "Stove Type Compatibility", values: ["Gas", "Electric", "Induction"] },
    ],
  });

  assert.equal(result.itemSpecifics["Stove Type Compatibility"], undefined);
  assert.deepEqual(result.missingItemSpecifics, ["Stove Type Compatibility"]);
});

test("resolveRequiredItemSpecifics resolves unknown aspect from title text", () => {
  const result = resolveRequiredItemSpecifics({
    title: "Stainless Steel Kitchen Knife Set with Wooden Block",
    categoryName: "Kitchen Knife Sets",
    brand: "Generic",
    itemSpecifics: {},
    requiredItemSpecifics: [
      { name: "Handle Material", values: ["Wood", "Plastic", "Stainless Steel", "Bamboo"] },
    ],
  });

  // "Wooden" in title contains "wood" substring, so "Wood" matches first
  assert.equal(result.itemSpecifics["Handle Material"], "Wood");
  assert.deepEqual(result.missingItemSpecifics, []);
});

test("resolveRequiredItemSpecifics resolves brand from title when Amazon brand is Unbranded", () => {
  const result = resolveRequiredItemSpecifics({
    title: "AMVR RGB Charging Dock Compatible with Meta Quest 3",
    categoryName: "VR Accessories",
    brand: "Unbranded",
    itemSpecifics: {},
    requiredItemSpecifics: [
      { name: "Brand", values: ["AMVR", "Oculus", "Meta", "Unbranded"] },
    ],
  });

  assert.equal(result.itemSpecifics.Brand, "AMVR");
  assert.deepEqual(result.missingItemSpecifics, []);
});
