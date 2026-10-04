import assert from "node:assert/strict";
import test from "node:test";
import { getErrorDetails, isObjectRecord } from "./error-details";

for (const [label, input, message, code] of [
  ["Error", new Error("expired"), "expired", undefined],
  ["object", { message: "denied", code: "42501" }, "denied", "42501"],
  ["string", "network failed", "network failed", undefined],
  ["null", null, "Unknown error", undefined],
  ["undefined", undefined, "Unknown error", undefined],
  ["number", 42, "Unknown error", undefined],
  ["malformed fields", { message: 123, code: 42501 }, "Unknown error", undefined],
  ["empty message", { message: "  " }, "Unknown error", undefined],
  ["array", ["error"], "Unknown error", undefined],
] as const) {
  test(`error details handles ${label}`, () => {
    assert.deepEqual(getErrorDetails(input), { message, code });
  });
}
test("error details tolerates throwing accessors without serializing objects", () => {
  const error = { get message() { throw new Error("getter"); }, get code() { throw new Error("getter"); },
    toString() { throw new Error("must not serialize"); } };
  assert.deepEqual(getErrorDetails(error), { message: "Unknown error", code: undefined });
  assert.equal(isObjectRecord(error), true);
});
