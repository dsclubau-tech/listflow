import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  extractVariantSelectionHints,
} from "./amazon-variant-selection";

describe("amazon-variant-selection", () => {
  test("extracts colour and size hints from product itemSpecifics", () => {
    const product = {
      title: "Sample Product",
      itemSpecifics: {
        Colour: "Black",
        Size: "Large",
        Style: "Modern",
      },
      variants: [],
    };

    const hints = extractVariantSelectionHints(product);
    assert.deepEqual(hints, {
      colour: "Black",
      size: "Large",
      style: "Modern",
      pattern: null,
      variantTitle: null,
    });
  });

  test("extracts variantTitle from primary variant when itemSpecifics are empty", () => {
    const product = {
      title: "Sample Product",
      itemSpecifics: {},
      variants: [
        {
          variantTitle: "Red, XL",
          itemSpecifics: {
            Color: "Red",
            Size: "XL",
          },
        },
      ],
    };

    const hints = extractVariantSelectionHints(product);
    assert.ok(hints);
    assert.equal(hints.colour, "Red");
    assert.equal(hints.size, "XL");
    assert.equal(hints.variantTitle, "Red, XL");
  });

  test("handles null or missing item specifics safely", () => {
    const product = {
      title: "Sample Product",
      itemSpecifics: null,
      variants: [],
    };

    const hints = extractVariantSelectionHints(product);
    assert.equal(hints, null);
  });
});
