import test from "node:test";
import assert from "node:assert/strict";
import {
  createStoreUnlockToken,
  verifyStoreUnlockToken,
  PROFILE_UNLOCK_COOKIE_NAME,
} from "./profile-lock";

test("Profile Lock - creates and verifies valid unlock token for store", () => {
  const storeId = "store_test_123";
  const token = createStoreUnlockToken(storeId);

  assert.equal(typeof token, "string");
  assert.ok(token.startsWith(`${storeId}:`));

  const isValid = verifyStoreUnlockToken(storeId, token);
  assert.equal(isValid, true);
});

test("Profile Lock - rejects token for a different store (cross-store protection)", () => {
  const storeA = "store_aaa_111";
  const storeB = "store_bbb_222";
  const tokenStoreA = createStoreUnlockToken(storeA);

  // Token created for Store A cannot unlock Store B
  const isValidForStoreB = verifyStoreUnlockToken(storeB, tokenStoreA);
  assert.equal(isValidForStoreB, false);
});

test("Profile Lock - rejects tampered token signature", () => {
  const storeId = "store_test_123";
  const token = createStoreUnlockToken(storeId);
  const parts = token.split(":");
  const tampered = `${parts[0]}:${parts[1]}:bad_signature_value`;

  assert.equal(verifyStoreUnlockToken(storeId, tampered), false);
});

test("Profile Lock - rejects expired token", () => {
  const storeId = "store_test_123";
  const token = createStoreUnlockToken(storeId);

  // With 0ms maxAgeMs, immediately considered expired
  const isExpired = verifyStoreUnlockToken(storeId, token, -1000);
  assert.equal(isExpired, false);
});

test("Profile Lock - cookie name is standardized", () => {
  assert.equal(PROFILE_UNLOCK_COOKIE_NAME, "listflow_profile_unlock");
});

test("Profile Lock - rejects null, undefined, and malformed inputs gracefully", () => {
  const storeId = "store_test_123";
  assert.equal(verifyStoreUnlockToken(storeId, null), false);
  assert.equal(verifyStoreUnlockToken(storeId, undefined), false);
  assert.equal(verifyStoreUnlockToken(storeId, ""), false);
  assert.equal(verifyStoreUnlockToken(storeId, "invalid-no-colons"), false);
  assert.equal(verifyStoreUnlockToken(storeId, "a:b"), false);
  assert.equal(verifyStoreUnlockToken(storeId, `${storeId}:not_a_number:signature`), false);
  assert.equal(verifyStoreUnlockToken("", "any:token:here"), false);
});

