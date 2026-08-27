import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the stable updater refuses unsafe Git states before stopping workers", () => {
  const source = readFileSync("scripts/update-listflow-workers.ps1", "utf8");
  const branchCheck = source.indexOf('$branch -ne "master"');
  const dirtyCheck = source.indexOf("status --porcelain");
  const configCheck = source.indexOf(
    '"Validating the current six-worker configuration"',
  );
  const stopWorkers = source.indexOf('"Stopping local workers gracefully"');

  assert.ok(branchCheck >= 0);
  assert.ok(dirtyCheck > branchCheck);
  assert.ok(configCheck > dirtyCheck);
  assert.ok(stopWorkers > configCheck);
  assert.match(source, /@\("merge", "--ff-only"/);
  assert.doesNotMatch(source, /reset\s+--hard/);
});

test("Stop All requests graceful exits instead of terminating processes", () => {
  const source = readFileSync("scripts/stop-listflow-workers.ps1", "utf8");
  assert.match(source, /local-workers\.stop/);
  assert.match(source, /\.worker\.lock/);
  assert.doesNotMatch(source, /Stop-Process|taskkill/i);
});

test("the supervisor launches peer-mode store-specific replicas", () => {
  const source = readFileSync("scripts/listflow-local-workers.ts", "utf8");
  assert.match(source, /LISTFLOW_WORKER_ROLE: "store-specific"/);
  assert.match(source, /LISTFLOW_AMAZON_RETRY_TARGET: "peer"/);
  assert.match(source, /LISTFLOW_WORKER_DATABASE_PROFILE: "deployed"/);
  assert.match(source, /LISTFLOW_WORKER_STOP_FILE: workerStopPath/);
});
