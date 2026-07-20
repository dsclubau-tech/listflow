import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTHENTICATED_PATH,
  getSafeCallbackPath,
  isPrivateAppPath,
  PRIVATE_APP_PATHS,
} from "./auth-navigation";

test("getSafeCallbackPath preserves local paths, query strings, and hashes", () => {
  assert.equal(
    getSafeCallbackPath("/drafts?page=2#product"),
    "/drafts?page=2#product"
  );
});

test("getSafeCallbackPath rejects external, protocol-relative, and login callbacks", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "javascript:alert(1)",
    "/login",
    "/login?callbackUrl=/login",
  ]) {
    assert.equal(getSafeCallbackPath(value), DEFAULT_AUTHENTICATED_PATH);
  }
});

test("getSafeCallbackPath uses the products page when no callback is supplied", () => {
  assert.equal(getSafeCallbackPath(null), DEFAULT_AUTHENTICATED_PATH);
  assert.equal(getSafeCallbackPath(""), DEFAULT_AUTHENTICATED_PATH);
});

test("isPrivateAppPath covers every ListFlow application page", () => {
  for (const path of PRIVATE_APP_PATHS) {
    assert.equal(isPrivateAppPath(path), true, `${path} should be private`);
    assert.equal(isPrivateAppPath(`${path}/nested`), true);
  }

  assert.equal(isPrivateAppPath("/login"), false);
  assert.equal(isPrivateAppPath("/api/auth/session"), false);
  assert.equal(isPrivateAppPath("/price-tracker"), false);
  assert.equal(isPrivateAppPath("/products-public"), false);
});
