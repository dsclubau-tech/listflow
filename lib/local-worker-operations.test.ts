import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Start All displays a supervisor startup failure instead of transferring out of the launcher", {
  skip: process.platform !== "win32",
}, () => {
  // Use a fake npm batch file: no real worker or database is started.
  const root = mkdtempSync(path.join(tmpdir(), "listflow launcher "));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync("scripts/start-all-listflow-workers.cmd", path.join(root, "scripts", "start.cmd"));
  writeFileSync(path.join(root, "npm.cmd"), "@echo off\r\necho TEST_STARTUP_FAILURE\r\nexit /b 7\r\n");
  const result = spawnSync("cmd.exe", ["/d", "/c", "scripts\\start.cmd"], {
    cwd: root, encoding: "utf8", input: "\r\n", timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7);
  assert.match(result.stdout, /TEST_STARTUP_FAILURE/);
  assert.match(result.stdout, /supervisor stopped with exit code 7/);
  assert.match(result.stdout, /workers are running in the background/);
});

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
