import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalWorkerDefinitions,
  getLocalWorkerRestartDelay,
  parseLocalWorkerStoreLoginIds,
} from "./local-worker-config";

const stores = [
  { id: "rk", name: "RK Ecommerce", loginId: "store-1" },
  {
    id: "aussie",
    name: "Aussie Walmart",
    loginId: "aussiewalmartonline",
  },
  { id: "oz", name: "Oz Metro", loginId: "oz-metro" },
];

test("the default local setup creates two unique workers per store", () => {
  const requested = parseLocalWorkerStoreLoginIds(undefined);
  const definitions = buildLocalWorkerDefinitions(stores, requested);

  assert.equal(definitions.length, 6);
  assert.equal(new Set(definitions.map((item) => item.workerId)).size, 6);
  assert.deepEqual(
    definitions.map((item) => item.workerId),
    [
      "local-store-1-a",
      "local-store-1-b",
      "local-aussiewalmartonline-a",
      "local-aussiewalmartonline-b",
      "local-oz-metro-a",
      "local-oz-metro-b",
    ],
  );
  assert.equal(definitions[0].logFileName, "worker-store-1-a.log");
  assert.equal(definitions[1].stopFileName, "local-store-1-b.stop");
});

test("local worker configuration fails closed when a store is missing", () => {
  assert.throws(
    () => buildLocalWorkerDefinitions(stores.slice(0, 2), ["store-1", "oz-metro"]),
    /Active ListFlow stores were not found for: oz-metro/,
  );
});

test("restart backoff is capped at thirty seconds", () => {
  assert.equal(getLocalWorkerRestartDelay(0), 5_000);
  assert.equal(getLocalWorkerRestartDelay(1), 15_000);
  assert.equal(getLocalWorkerRestartDelay(2), 30_000);
  assert.equal(getLocalWorkerRestartDelay(10), 30_000);
});
