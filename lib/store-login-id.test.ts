import assert from "node:assert/strict";
import test from "node:test";
import { hasStoreLoginIdWhitespace } from "@/lib/store-login-id";

test("store login IDs reject internal and surrounding whitespace", () => {
  assert.equal(hasStoreLoginIdWhitespace("oz metro"), true);
  assert.equal(hasStoreLoginIdWhitespace(" oz-metro"), true);
  assert.equal(hasStoreLoginIdWhitespace("oz-metro "), true);
  assert.equal(hasStoreLoginIdWhitespace("oz\tmetro"), true);
});

test("store login IDs allow the documented compact format", () => {
  assert.equal(hasStoreLoginIdWhitespace("oz-metro"), false);
  assert.equal(hasStoreLoginIdWhitespace("STORE-2"), false);
  assert.equal(hasStoreLoginIdWhitespace("store2"), false);
});
