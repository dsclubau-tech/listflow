import assert from "node:assert/strict";
import test from "node:test";
import { createOrdersWorkerLane, isOrdersStoreEntitled } from "./orders-worker-lane";

test("order lane is independent, single flight, and isolates store failures", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const synced: string[] = [], errors: string[] = [];
  const lane = createOrdersWorkerLane({
    getStores: async () => [{ id: "failed", ownerUserId: null }, { id: "good", ownerUserId: null }, { id: "held", ownerUserId: null }],
    isEligible: async store => store.id !== "held",
    sync: async id => { synced.push(id); if (id === "failed") throw new Error("failed"); await waiting; },
    paused: () => false, reportError: (_error, id) => { errors.push(id!); },
  });
  const first = lane.tick(), second = lane.tick();
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(synced, ["failed", "good"]);
  release(); await first;
  assert.deepEqual(errors, ["failed"]);
  await lane.stop();
  await lane.tick();
  assert.equal(synced.length, 2);
});

test("paused lane drains an in-flight import before database pool reset", async () => {
  let paused = false, release!: () => void, drained = false, runs = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const lane = createOrdersWorkerLane({
    getStores: async () => [{ id: "store", ownerUserId: null }], isEligible: async () => true,
    sync: async () => { runs++; await waiting; }, paused: () => paused, reportError: () => {},
  });
  const run = lane.tick(); await new Promise(resolve => setTimeout(resolve, 0));
  paused = true;
  const drain = lane.drain().then(() => { drained = true; });
  const pausedTick = lane.tick();
  assert.equal(drained, false);
  release(); await Promise.all([run, drain, pausedTick]);
  assert.equal(drained, true);
  await lane.tick(); assert.equal(runs, 1);
  await lane.stop();
});

test("order syncing applies the same active-entitlement and store-ranking gate", async () => {
  const ranked = [{ id: "first" }, { id: "second" }];
  const deps = { getEntitlement: async () => ({ status: "ACTIVE", allowedStores: 1 }), getRankedStores: async () => ranked };
  assert.equal(await isOrdersStoreEntitled({ id: "first", ownerUserId: "owner" }, deps), true);
  assert.equal(await isOrdersStoreEntitled({ id: "second", ownerUserId: "owner" }, deps), false);
  assert.equal(await isOrdersStoreEntitled({ id: "missing", ownerUserId: "owner" }, deps), false);
  assert.equal(await isOrdersStoreEntitled({ id: "first", ownerUserId: "owner" }, { ...deps, getEntitlement: async () => ({ status: "INACTIVE", allowedStores: 10 }) }), false);
  assert.equal(await isOrdersStoreEntitled({ id: "legacy", ownerUserId: null }, deps), true);
});
