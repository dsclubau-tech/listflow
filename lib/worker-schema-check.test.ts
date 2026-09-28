import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerSchemaReady } from "./worker-schema-check";

test("schema check probes the location column even without settings rows", async () => {
  await assertWorkerSchemaReady({ supplierSettings: { findFirst: async (args) => {
    assert.deepEqual(args, { select: { defaultLocationText: true } });
    return null;
  } } });
});

for (const code of ["P2022", "P2021"]) {
  test(`schema check explains missing schema (${code})`, async () => {
    await assert.rejects(assertWorkerSchemaReady({ supplierSettings: { findFirst: async () => {
      throw Object.assign(new Error("missing schema"), { code });
    } } }), /table-owner migration account/);
  });
}

test("schema check preserves connection failures", async () => {
  const failure = Object.assign(new Error("connection unavailable"), { code: "P1001" });
  await assert.rejects(assertWorkerSchemaReady({ supplierSettings: { findFirst: async () => {
    throw failure;
  } } }), (error) => error === failure);
});
