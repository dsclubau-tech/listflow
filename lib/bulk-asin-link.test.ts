import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBulkAsinMappingText,
  resolveBulkAsinMappings,
  validateBulkAsinMappings,
  type BulkAsinCandidate,
} from "@/lib/bulk-asin-link";

const candidates: BulkAsinCandidate[] = [
  {
    id: "item-match",
    ebayItemId: "307016023995",
    variants: [{ sku: null }],
  },
  {
    id: "sku-match",
    ebayItemId: "307000000001",
    variants: [{ sku: "Custom-Sku" }],
  },
];

test("parses comma and tab separated ASIN mappings", () => {
  const parsed = parseBulkAsinMappingText(
    "307016023995, B07VJ5LG19\nCustom-Sku\tB0FBZZPQQG",
  );

  assert.deepEqual(parsed.invalid, []);
  assert.deepEqual(parsed.mappings, [
    { identifier: "307016023995", asin: "B07VJ5LG19" },
    { identifier: "Custom-Sku", asin: "B0FBZZPQQG" },
  ]);
});

test("reports malformed lines before submission", () => {
  const parsed = parseBulkAsinMappingText("307016023995 B07VJ5LG19");

  assert.equal(parsed.mappings.length, 0);
  assert.equal(parsed.invalid[0].line, 1);
});

test("normalizes, validates, deduplicates, and rejects conflicting mappings", () => {
  const result = validateBulkAsinMappings([
    { identifier: " Custom-Sku ", asin: " b07vj5lg19 " },
    { identifier: "custom-sku", asin: "B07VJ5LG19" },
    { identifier: "bad", asin: "short" },
    { identifier: "conflict", asin: "B07VJ5LG19" },
    { identifier: "CONFLICT", asin: "B0FBZZPQQG" },
  ]);

  assert.deepEqual(result.mappings, [
    { identifier: "custom-sku", asin: "B07VJ5LG19" },
  ]);
  assert.equal(result.invalid.length, 2);
});

test("matches eBay item IDs first and unique SKUs case-insensitively", () => {
  const resolution = resolveBulkAsinMappings(candidates, [
    { identifier: "307016023995", asin: "B07VJ5LG19" },
    { identifier: "CUSTOM-SKU", asin: "B0FBZZPQQG" },
  ]);

  assert.deepEqual(
    resolution.updates.map(({ productId, asin }) => ({ productId, asin })),
    [
      { productId: "item-match", asin: "B07VJ5LG19" },
      { productId: "sku-match", asin: "B0FBZZPQQG" },
    ],
  );
});

test("reports unmatched and duplicate-SKU identifiers without updating", () => {
  const resolution = resolveBulkAsinMappings(
    [
      ...candidates,
      {
        id: "duplicate-sku",
        ebayItemId: "307000000002",
        variants: [{ sku: "custom-sku" }],
      },
    ],
    [
      { identifier: "CUSTOM-SKU", asin: "B07VJ5LG19" },
      { identifier: "MISSING", asin: "B0FBZZPQQG" },
    ],
  );

  assert.deepEqual(resolution.updates, []);
  assert.deepEqual(resolution.ambiguous, ["CUSTOM-SKU"]);
  assert.deepEqual(resolution.unmatched, ["MISSING"]);
});

test("eBay item ID takes precedence over a duplicate SKU value", () => {
  const resolution = resolveBulkAsinMappings(
    [
      ...candidates,
      {
        id: "sku-shadow",
        ebayItemId: "307000000003",
        variants: [{ sku: "307016023995" }],
      },
    ],
    [{ identifier: "307016023995", asin: "B07VJ5LG19" }],
  );

  assert.equal(resolution.updates[0].productId, "item-match");
});
