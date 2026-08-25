import assert from "node:assert/strict";
import test from "node:test";
import {
  getProductSelectionScopeKey,
  hasEverySelected,
  setPageSelection,
} from "./product-selection";

test("selection scope ignores pagination but changes with filters", () => {
  assert.equal(
    getProductSelectionScopeKey("filter=all&page=3&pageSize=25&productId=focused&q=mic"),
    "filter=all&q=mic",
  );
  assert.notEqual(
    getProductSelectionScopeKey("filter=all&q=mic"),
    getProductSelectionScopeKey("filter=all&q=cable"),
  );
});

test("selecting a page preserves selections from other pages", () => {
  assert.deepEqual(
    setPageSelection(["page-1"], ["page-2", "page-3"], true),
    ["page-1", "page-2", "page-3"],
  );
  assert.deepEqual(
    setPageSelection(["page-1", "page-2", "page-3"], ["page-2", "page-3"], false),
    ["page-1"],
  );
});

test("all-selected checks the complete candidate set", () => {
  assert.equal(hasEverySelected(["a", "b", "c"], ["a", "b"]), true);
  assert.equal(hasEverySelected(["a"], ["a", "b"]), false);
  assert.equal(hasEverySelected([], []), false);
});
