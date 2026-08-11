import assert from "node:assert/strict";
import test from "node:test";
import { isWorkerEnabled } from "./worker-enabled";

test("workers remain enabled by default for backward compatibility", () => {
  assert.equal(isWorkerEnabled(undefined), true);
  assert.equal(isWorkerEnabled(""), true);
  assert.equal(isWorkerEnabled("true"), true);
});

test("workers can be explicitly parked without claiming jobs", () => {
  for (const value of ["0", "false", "FALSE", " no ", "off"]) {
    assert.equal(isWorkerEnabled(value), false);
  }
});
