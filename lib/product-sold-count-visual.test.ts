import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sold counts use the Views-style metric pill for positive and zero values", () => {
  const source = readFileSync("components/DraftsTable.tsx", "utf8");
  const usages = source.match(/<SoldCountBadge\b/g) ?? [];

  assert.equal(usages.length, 2);
  assert.match(
    source,
    /function SoldCountBadge[\s\S]*?bg-blue-50[\s\S]*?ring-blue-600\/20/,
  );
  assert.doesNotMatch(source, /product\.quantitySold > 0 \?/);
});
