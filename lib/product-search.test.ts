import assert from "node:assert/strict";
import test from "node:test";
import { buildProductSearchWhere, rankProductSearchResults } from "@/lib/product-search";

test("shared product search covers full titles, identifiers, notes, brands, and SKUs", () => {
  const serialized = JSON.stringify(buildProductSearchWhere("abc"));
  for (const field of ["title", "fullTitle", "id", "asin", "ebayItemId", "internalNote", "Brand", "brand", "sku"]) {
    assert.equal(serialized.includes(`\"${field}\"`), true, field);
  }
});

test("search ranking puts exact identifiers before title matches with stable ties", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const rows = [
    { id: "z", title: "ABC cable", fullTitle: null, asin: null, ebayItemId: null, updatedAt: at, variants: [] },
    { id: "a", title: "other", fullTitle: null, asin: "ABC", ebayItemId: null, updatedAt: at, variants: [] },
    { id: "b", title: "ABC", fullTitle: null, asin: null, ebayItemId: null, updatedAt: at, variants: [] },
  ];
  assert.deepEqual(rankProductSearchResults(rows, "abc").map((row) => row.id), ["a", "b", "z"]);
});
