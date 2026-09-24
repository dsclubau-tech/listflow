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

test("Stop All tolerates disappearing worker and supervisor locks while waiting for another worker", {
  skip: process.platform !== "win32",
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "listflow stop race "));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "logs"));
  copyFileSync("scripts/stop-listflow-workers.ps1", path.join(root, "scripts", "stop.ps1"));
  writeFileSync(path.join(root, "logs", "local-store-1-a.worker.lock"), "111");
  writeFileSync(path.join(root, "logs", "local-store-1-b.worker.lock"), "222");
  writeFileSync(path.join(root, "logs", "local-workers.supervisor.lock"), "333");
  // All process checks are simulated. Only temporary fixture files are removed.
  writeFileSync(path.join(root, "simulate.ps1"), `
$ErrorActionPreference = "Stop"
$script:workerChecks = 0
function Get-Content {
  [CmdletBinding()]
  param([string]$LiteralPath, [switch]$Raw)
  if ($LiteralPath.EndsWith("local-store-1-b.worker.lock") -or $LiteralPath.EndsWith("local-workers.supervisor.lock")) {
    Remove-Item -LiteralPath $LiteralPath -Force
  }
  Microsoft.PowerShell.Management\\Get-Content @PSBoundParameters
}
function Get-Process {
  [CmdletBinding()]
  param([int]$Id)
  if ($Id -eq 111) {
    $script:workerChecks++
    if ($script:workerChecks -le 2) { [pscustomobject]@{ Id = $Id } }
  }
}
function Get-CimInstance {
  [CmdletBinding()]
  param([string]$ClassName, [string]$Filter)
  [pscustomobject]@{ CommandLine = "node scripts/listflow-worker.ts" }
}
function Start-Sleep { param([int]$Seconds) }
& (Join-Path $PSScriptRoot "scripts/stop.ps1")
`);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "simulate.ps1")], {
    cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Waiting for 1 worker process/);
  assert.match(result.stdout, /All local ListFlow workers stopped/);
  assert.equal(result.stderr, "");
});

test("the supervisor launches peer-mode store-specific replicas", () => {
  const source = readFileSync("scripts/listflow-local-workers.ts", "utf8");
  assert.match(source, /LISTFLOW_WORKER_ROLE: "store-specific"/);
  assert.match(source, /LISTFLOW_AMAZON_RETRY_TARGET: "peer"/);
  assert.match(source, /LISTFLOW_WORKER_DATABASE_PROFILE: "deployed"/);
  assert.match(source, /LISTFLOW_WORKER_STOP_FILE: workerStopPath/);
});
