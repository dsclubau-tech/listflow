import assert from "node:assert/strict";
import test from "node:test";
import { getStoreBadgeClass } from "./store-badge";

test("store badges are stable for renamed/custom stores", () => {
  assert.equal(
    getStoreBadgeClass("store-rkecom", "rkecom"),
    getStoreBadgeClass("store-rkecom", "Renamed store"),
  );
});

test("store badges have a safe fallback when both identifiers are blank", () => {
  assert.equal(getStoreBadgeClass("", ""), "bg-gray-100 text-gray-800");
});
