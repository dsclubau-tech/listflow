import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("product promotion and price tracking badges are stacked without checked timestamps", () => {
  const source = readFileSync("components/DraftsTable.tsx", "utf8");

  assert.match(
    source,
    /className="flex max-w-\[13rem\] flex-col items-start gap-1\.5"/,
  );
  assert.match(
    source,
    /\{\(promotedAdState \|\| trackingState\) && \([\s\S]*?inline-flex flex-col items-start gap-1\.5/,
  );
  assert.match(source, /trackingState\.label !== "No change" && \(/);
  assert.doesNotMatch(
    source,
    /className="mt-1 block truncate text-xs text-gray-500"/,
  );
});
