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
  mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", ".bin", "tsx.cmd"), "@exit /b 0\r\n");
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

test("Start All explains how to repair missing dependencies without attempting to start workers", {
  skip: process.platform !== "win32",
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "listflow missing runtime "));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync("scripts/start-all-listflow-workers.cmd", path.join(root, "scripts", "start.cmd"));
  writeFileSync(path.join(root, "npm.cmd"), "@echo UNEXPECTED_WORKER_START\r\nexit /b 0\r\n");
  const result = spawnSync("cmd.exe", ["/d", "/c", "scripts\\start.cmd"], {
    cwd: root, encoding: "utf8", input: "\r\n", timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /npm.cmd ci --include=dev/);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_WORKER_START|supervisor is already running/);
});

function simulateWorkerUpdate(options: {
  runtime?: "missing" | "healthy" | "broken";
  installFails?: boolean;
  stopFails?: boolean;
  configFails?: boolean;
  dirty?: boolean;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "listflow update runtime "));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync("scripts/update-listflow-workers.ps1", path.join(root, "scripts", "update.ps1"));
  writeFileSync(path.join(root, ".env"), "# Test fixture only\n");
  writeFileSync(path.join(root, "events.log"), "");
  if (options.runtime && options.runtime !== "missing") {
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".bin", "tsx.cmd"),
      `@exit /b ${options.runtime === "broken" ? 1 : 0}\r\n`);
  }
  // Intercept every external action. No network, installs, database, or real workers.
  writeFileSync(path.join(root, "simulate.ps1"), `
$ErrorActionPreference = "Stop"
$global:listflowTestRoot = $PSScriptRoot
function Record-Event($message) {
  Add-Content -LiteralPath (Join-Path $global:listflowTestRoot "events.log") -Value $message
}
function git.exe {
  Record-Event ("git " + ($args -join " "))
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    "branch" { "master" }
    "status" { ${options.dirty ? '" M package.json"' : '""'} }
    "rev-parse" { "same-commit" }
  }
}
function node.exe {
  $global:LASTEXITCODE = 0
  "1.58.2"
}
function npm.cmd {
  Record-Event ("npm " + ($args -join " "))
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "ci") {
    if (${options.installFails ? "$true" : "$false"}) {
      $global:LASTEXITCODE = 23
      return
    }
    if ($args -notcontains "--include=dev") { throw "Worker tools were omitted" }
    $binDir = Join-Path $global:listflowTestRoot "node_modules/.bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Set-Content -LiteralPath (Join-Path $binDir "tsx.cmd") -Value "@exit /b 0"
  }
  if ($args[0] -eq "run" -and $args[1] -eq "workers:local:check") {
    $runtime = Join-Path $global:listflowTestRoot "node_modules/.bin/tsx.cmd"
    if (-not (Test-Path -LiteralPath $runtime)) { throw "Configuration ran before dependency repair" }
    & $runtime --version
    if ($LASTEXITCODE -ne 0) { throw "Configuration ran with a broken runtime" }
    if (${options.configFails ? "$true" : "$false"}) { $global:LASTEXITCODE = 24 }
  }
}
function powershell.exe {
  Record-Event "stop"
  $global:LASTEXITCODE = ${options.stopFails ? 25 : 0}
}
function Start-Process {
  param($FilePath, $WorkingDirectory, $WindowStyle)
  Record-Event "start"
}
& (Join-Path $PSScriptRoot "scripts/update.ps1")
exit $LASTEXITCODE
`);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "simulate.ps1")], {
    cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true,
    env: { ...process.env, NODE_ENV: "production", npm_config_omit: "dev" },
  });
  assert.equal(result.error, undefined);
  return { ...result, events: readFileSync(path.join(root, "events.log"), "utf8").trim().split(/\r?\n/) };
}

for (const runtime of ["missing", "broken", "healthy"] as const) {
  test(`Update repairs a ${runtime} runtime on an already up-to-date checkout`, {
    skip: process.platform !== "win32",
  }, () => {
    const result = simulateWorkerUpdate({ runtime });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /files are up to date/);
    const stop = result.events.indexOf("stop");
    const install = result.events.indexOf("npm ci --include=dev");
    const checks = result.events.flatMap((event, index) => event === "npm run workers:local:check" ? [index] : []);
    assert.ok(stop >= 0 && install > stop, result.events.join("\n"));
    assert.ok(checks.at(-1)! > install);
    assert.ok(result.events.indexOf("start") > checks.at(-1)!);
    if (runtime === "healthy") {
      assert.equal(checks.length, 2);
      assert.ok(checks[0] < stop);
    } else {
      assert.equal(checks.length, 1);
      assert.match(result.stdout, /missing or damaged/);
    }
  });
}

test("Update does not restart workers after a dependency install or configuration failure", {
  skip: process.platform !== "win32",
}, () => {
  for (const options of [{ installFails: true }, { configFails: true }]) {
    const result = simulateWorkerUpdate(options);
    assert.equal(result.status, 1);
    assert.ok(result.events.includes("npm ci --include=dev"));
    assert.ok(!result.events.includes("start"));
    assert.match(result.stdout, /Update failed/);
  }
});

test("Update refuses dependency changes if workers cannot stop or Git has local changes", {
  skip: process.platform !== "win32",
}, () => {
  for (const options of [{ stopFails: true }, { dirty: true }]) {
    const result = simulateWorkerUpdate(options);
    assert.equal(result.status, 1);
    assert.ok(!result.events.includes("npm ci --include=dev"));
    assert.ok(!result.events.includes("git merge --ff-only origin/master"));
    assert.ok(!result.events.includes("start"));
    if ("dirty" in options) assert.ok(!result.events.includes("stop"));
  }
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
