import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEbayStoreNumber,
  resolveEbayStoreNumber,
  resolveLegacyEbayStoreNumber,
  validateStoreDisplayName,
} from "@/lib/store-profile";

test("store display names are trimmed and internal whitespace is normalized", () => {
  assert.deepEqual(validateStoreDisplayName("  Kahaf's   eBay Store  "), {
    ok: true,
    name: "Kahaf's eBay Store",
  });
});

test("store display names reject empty and overlong values", () => {
  assert.equal(validateStoreDisplayName("   ").ok, false);
  assert.equal(validateStoreDisplayName("x".repeat(81)).ok, false);
});

test("legacy eBay account resolution prefers the stable login ID", () => {
  assert.equal(
    resolveLegacyEbayStoreNumber({ loginId: "store-2", name: "My Store" }),
    2,
  );
  assert.equal(
    resolveLegacyEbayStoreNumber({ loginId: "custom", name: "Store 3" }),
    3,
  );
  assert.equal(
    resolveLegacyEbayStoreNumber({ loginId: "custom", name: "My Store" }),
    null,
  );
});

test("configured eBay account numbers accept only supported accounts", () => {
  assert.equal(normalizeEbayStoreNumber(1), 1);
  assert.equal(normalizeEbayStoreNumber("3"), 3);
  assert.equal(normalizeEbayStoreNumber(4), null);
});

test("a configured eBay account remains stable after the store is renamed", () => {
  assert.equal(
    resolveEbayStoreNumber({
      configuredStoreNumber: 2,
      loginId: "custom-login",
      name: "Kahaf's eBay Store",
    }),
    2,
  );
});
