import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseLogWriter } from "./database-log-writer";

test("an outage log burst cannot consume more than one database request", async () => {
  let fail: (error: Error) => void = () => undefined;
  let calls = 0;
  let now = 0;
  const errors: unknown[] = [];
  const writer = createDatabaseLogWriter({ now: () => now, onError: (error) => errors.push(error) });
  const failedWrite = writer.write(async () => {
    calls++;
    await new Promise<void>((_resolve, reject) => { fail = reject; });
  });
  await Promise.resolve();
  const burst = Promise.all(Array.from({ length: 100 }, () => writer.write(async () => { calls++; })));
  assert.equal(calls, 1);
  fail(new Error("timeout exceeded when trying to connect"));
  await Promise.all([failedWrite, burst]);
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  await writer.write(async () => { calls++; });
  assert.equal(calls, 1);
  now = 30_000;
  await writer.write(async () => { calls++; });
  assert.equal(calls, 2);
});

test("ordinary log bursts are retained and written sequentially", async () => {
  const written: number[] = [];
  const writer = createDatabaseLogWriter({ onError: () => assert.fail("Unexpected log failure") });
  await Promise.all(Array.from({ length: 20 }, (_, id) => writer.write(async () => {
    await Promise.resolve();
    written.push(id);
  })));
  assert.deepEqual(written, Array.from({ length: 20 }, (_, id) => id));
});

test("pool recovery waits for the active log write and suppresses new writes until resumed", async () => {
  let complete: () => void = () => undefined;
  let calls = 0;
  const writer = createDatabaseLogWriter({ onError: () => undefined });
  const first = writer.write(async () => {
    calls++;
    await new Promise<void>((resolve) => { complete = resolve; });
  });
  await Promise.resolve();
  let drained = false;
  const paused = writer.pause().then(() => { drained = true; });
  await writer.write(async () => { calls++; });
  assert.equal(drained, false);
  assert.equal(calls, 1);
  complete();
  await Promise.all([first, paused]);
  assert.equal(drained, true);
  await writer.write(async () => { calls++; });
  assert.equal(calls, 1);
  writer.resume();
  await writer.write(async () => { calls++; });
  assert.equal(calls, 2);
});
