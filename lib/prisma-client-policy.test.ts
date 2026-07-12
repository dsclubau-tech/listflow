import assert from "node:assert/strict";
import test from "node:test";
import { reuseOrCreateClient } from "./prisma-client-policy";

test("reuseOrCreateClient always reuses an existing development client", () => {
  const existing = { id: "existing" };
  let createCalls = 0;
  const result = reuseOrCreateClient(existing, () => {
    createCalls += 1;
    return { id: "new" };
  });

  assert.equal(result, existing);
  assert.equal(createCalls, 0);
});

test("reuseOrCreateClient creates a client when none exists", () => {
  const result = reuseOrCreateClient(undefined, () => ({ id: "new" }));
  assert.deepEqual(result, { id: "new" });
});
