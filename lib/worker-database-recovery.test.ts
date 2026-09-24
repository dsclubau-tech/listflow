import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlightTask, isDatabaseConnectionError, WorkerDatabaseRecovery } from "./worker-database-recovery";

test("repeated pool acquisition failures request recovery; successful work resets the streak", () => {
  const recovery = new WorkerDatabaseRecovery();
  const outage = new Error("timeout exceeded when trying to connect");
  assert.equal(recovery.recordFailure(outage), false);
  assert.equal(recovery.recordFailure(outage), false);
  recovery.recordSuccess();
  assert.equal(recovery.recordFailure(outage), false);
  assert.equal(recovery.recordFailure(outage), false);
  assert.equal(recovery.recordFailure(outage), true);
});

test("listing validation and programming errors never trigger a pool reset", () => {
  const recovery = new WorkerDatabaseRecovery();
  for (let count = 0; count < 5; count++) {
    assert.equal(recovery.recordFailure(new Error("Add Style before importing.")), false);
    assert.equal(recovery.recordFailure(new Error("Unknown argument category")), false);
  }
  assert.equal(isDatabaseConnectionError({ cause: { code: "P1001" } }), true);
  assert.equal(isDatabaseConnectionError({ code: "P2024" }), true);
  assert.equal(isDatabaseConnectionError(new Error("Amazon request timed out")), false);
  assert.equal(isDatabaseConnectionError({ message: "eBay request failed", cause: { code: "ETIMEDOUT" } }), false);
});

test("slow heartbeat calls share one request and resume after failure", async () => {
  let requests = 0;
  let reject: (error: Error) => void = () => undefined;
  const send = createSingleFlightTask(async () => {
    requests++;
    if (requests === 1) await new Promise<void>((_resolve, fail) => { reject = fail; });
    return requests;
  });
  const first = send();
  const second = send();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(requests, 1);
  const failed = assert.rejects(first, /connection lost/);
  reject(new Error("connection lost"));
  await failed;
  assert.equal(await send(), 2);
});
