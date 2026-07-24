import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateStorePassword } from "./store-password-policy";

describe("store-password-policy", () => {
  test("accepts strong password", () => {
    const result = validateStorePassword("StrongPass123");
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test("rejects short password", () => {
    const result = validateStorePassword("Ab1");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("at least 8 characters")));
  });

  test("rejects missing uppercase", () => {
    const result = validateStorePassword("lowercase123");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("uppercase")));
  });

  test("rejects missing lowercase", () => {
    const result = validateStorePassword("UPPERCASE123");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("lowercase")));
  });

  test("rejects missing digit", () => {
    const result = validateStorePassword("NoNumbersHere");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("number")));
  });
});
