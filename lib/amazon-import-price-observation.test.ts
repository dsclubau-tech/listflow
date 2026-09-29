import assert from "node:assert/strict";
import test from "node:test";
import { selectImportPriceObservation, type ImportPriceObservation } from "./amazon-import-price-observation";

const asin = "B0TEST1234";
const empty = { asin, regular: null, deal: null };
const price = { asin, containerSelector: "#buybox", price: 25, priceSource: "localized_buybox" as const, selector: ".priceToPay", mode: "REGULAR" as const, label: "Regular price" };
const observation = (outcome: ImportPriceObservation["buyBoxOutcome"], source: ImportPriceObservation["source"], regular: typeof price | null = price): ImportPriceObservation => ({
  asin, source, postcodeVerified: true, buyBoxOutcome: outcome,
  choices: { ...empty, regular },
});

test("later verified available price replaces unavailable page", () => {
  const result = selectImportPriceObservation([
    observation("UNAVAILABLE", "localized", null),
    observation("AVAILABLE", "rendered"),
  ], asin, "REGULAR", true);
  assert.equal(result.observation?.source, "rendered");
  assert.equal(result.choice?.price, 25);
});

test("later verified unavailability clears an earlier price", () => {
  const result = selectImportPriceObservation([
    observation("AVAILABLE", "localized"),
    observation("UNAVAILABLE", "retry", null),
  ], asin, "REGULAR", true);
  assert.equal(result.observation?.buyBoxOutcome, "UNAVAILABLE");
  assert.equal(result.choice, null);
});

test("unverified and wrong-ASIN observations are never selected", () => {
  const wrongPostcode = { ...observation("AVAILABLE", "rendered"), postcodeVerified: false };
  const wrongAsin = { ...observation("AVAILABLE", "rendered"), asin: "B0WRONG123" };
  assert.equal(selectImportPriceObservation([wrongPostcode, wrongAsin], asin, "REGULAR", true).choice, null);
});

test("unknown later observation does not turn a known price into unavailable", () => {
  const result = selectImportPriceObservation([
    observation("AVAILABLE", "localized"),
    observation("UNKNOWN", "rendered", null),
  ], asin, "REGULAR", true);
  assert.equal(result.choice?.price, 25);
});
