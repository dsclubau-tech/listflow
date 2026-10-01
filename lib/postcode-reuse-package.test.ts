import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

test("portable package validates baseline, refuses unexpected changes, and installs without touching settings", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "listflow-postcode-package-"));
  const output = path.join(folder, "package");
  const worker = path.join(folder, "worker");
  const execute = (script: string, ...args: string[]) => spawnSync("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { encoding: "utf8" });
  try {
    const built = execute("scripts/package-postcode-reuse-rollout.ps1", "-OutputRoot", output);
    assert.equal(built.status, 0, built.stderr);
    const root = path.join(output, "postcode-reuse-rollout");
    const installer = path.join(root, "Install.ps1");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as {
      files: Array<{ path: string; baselineHash: string }>;
    };
    fs.mkdirSync(path.join(worker, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(path.join(worker, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(worker, "node_modules", ".bin", "tsx.cmd"), "@echo off");
    const settings = 'DO_NOT_CHANGE="local-credentials"\r\n';
    fs.writeFileSync(path.join(worker, ".env"), settings);
    fs.writeFileSync(path.join(worker, "scripts", "stop-listflow-workers.ps1"),
      '[IO.File]::WriteAllText((Join-Path $PSScriptRoot "../stopped.txt"), "graceful"); exit 0');
    for (const file of manifest.files) {
      if (!file.baselineHash) continue;
      const target = path.join(worker, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const source = execFileSync("git", ["show", `HEAD:${file.path}`], { encoding: "utf8" });
      fs.writeFileSync(target, source.replace(/\r?\n/g, "\r\n"));
    }
    assert.equal(execute(installer, "-WorkerRoot", worker, "-ValidateOnly").status, 0);
    const first = path.join(worker, manifest.files[0].path);
    const original = fs.readFileSync(first, "utf8");
    fs.appendFileSync(first, "\n// unexpected local change");
    const refused = execute(installer, "-WorkerRoot", worker);
    assert.notEqual(refused.status, 0);
    assert.ok(refused.stderr.includes("differs from the tested baseline"));
    assert.equal(fs.existsSync(path.join(worker, "stopped.txt")), false);
    fs.writeFileSync(first, original);
    const installed = execute(installer, "-WorkerRoot", worker);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(fs.readFileSync(path.join(worker, ".env"), "utf8"), settings);
    assert.equal(fs.readFileSync(path.join(worker, "stopped.txt"), "utf8"), "graceful");
    for (const file of manifest.files) {
      assert.equal(fs.readFileSync(path.join(worker, file.path), "utf8"),
        fs.readFileSync(path.join(root, "payload", file.path), "utf8"));
    }
    assert.equal(execute(installer, "-WorkerRoot", worker, "-ValidateOnly").status, 0);
    assert.ok(fs.existsSync(path.join(output, "postcode-reuse-rollout.zip")));
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("activation evidence refuses changed report content and changed worker fingerprint", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "listflow-postcode-evidence-"));
  const current = path.join(folder, "current");
  const run = (...args: string[]) => spawnSync(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/postcode-reuse-evidence.ts", "--folder", folder, ...args,
  ], { encoding: "utf8" });
  try {
    const preflight = { fingerprint: "worker-fingerprint", pacing: { minMs: 3000, maxMs: 7000 }, stores: [{ loginId: "rk", postcode: "2217" }] };
    const products = Array.from({ length: 30 }, (_, index) => ({ asin: `B${String(index).padStart(9, "0")}` }));
    fs.writeFileSync(path.join(folder, "preflight.json"), JSON.stringify(preflight));
    fs.writeFileSync(path.join(folder, "rk.input.json"), JSON.stringify({ postcode: "2217", products }));
    const report = { products: 30, matches: 30, mismatches: 0, optimizations: ["delivery-state"],
      pacing: preflight.pacing, deliveryEvents: ["1:seeded", "2:reused"],
      comparisons: products.map(product => ({ asin: product.asin, match: true, experiment: {
        outcome: { kind: "result", price: 12, postcodeVerified: true },
      } })) };
    fs.writeFileSync(path.join(folder, "rk.report.json"), JSON.stringify(report));
    assert.equal(run().status, 0);
    fs.mkdirSync(current);
    fs.writeFileSync(path.join(current, "preflight.json"), JSON.stringify(preflight));
    assert.equal(run("--current", current).status, 0);
    fs.appendFileSync(path.join(folder, "rk.report.json"), "\n");
    assert.notEqual(run("--current", current).status, 0);
    fs.writeFileSync(path.join(folder, "rk.report.json"), JSON.stringify(report));
    fs.writeFileSync(path.join(current, "preflight.json"), JSON.stringify({ ...preflight, fingerprint: "new-settings" }));
    assert.notEqual(run("--current", current).status, 0);
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("global rollback works without a database and restarts workers from the updated file", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "listflow-postcode-rollback-"));
  try {
    fs.mkdirSync(path.join(folder, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(path.join(folder, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".env"), 'LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE="all"\n');
    fs.writeFileSync(path.join(folder, "fake-tool.cjs"), `
      const fs = require("fs"), path = require("path");
      const root = __dirname;
      const args = process.argv.slice(2);
      if (args[0] !== "scripts\\\\configure-postcode-reuse.ts") throw Error("Unexpected database/preflight operation");
      fs.appendFileSync(path.join(root, "calls.txt"), args.join(" ") + "\\n");
      if (args.includes("--write")) fs.writeFileSync(path.join(root, ".env"), 'LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE="off"\\n');
    `);
    fs.writeFileSync(path.join(folder, "node_modules", ".bin", "tsx.cmd"),
      '@echo off\r\nnode.exe "%~dp0..\\..\\fake-tool.cjs" %*\r\n');
    fs.writeFileSync(path.join(folder, "scripts", "stop-listflow-workers.ps1"),
      '[IO.File]::WriteAllText((Join-Path $PSScriptRoot "../stopped.txt"), "yes"); exit 0');
    fs.writeFileSync(path.join(folder, "record-start.cjs"), `
      require("fs").writeFileSync(require("path").join(__dirname, "started.json"), JSON.stringify({
        mode: process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE ?? null,
        features: process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS ?? null,
        unrelated: process.env.POSTCODE_FIXTURE_UNRELATED,
      }));
    `);
    fs.writeFileSync(path.join(folder, "scripts", "start-all-listflow-workers.cmd"),
      '@echo off\r\nnode.exe "%~dp0..\\record-start.cjs"\r\n');
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("scripts/postcode-reuse-rollout.ps1"), "-WorkerRoot", folder, "-Action", "off"],
      { encoding: "utf8", env: { ...process.env, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: "all",
        LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "delivery-state,shared-snapshot", POSTCODE_FIXTURE_UNRELATED: "keep" } });
    assert.equal(result.status, 0, result.stderr);
    for (let attempt = 0; attempt < 30 && !fs.existsSync(path.join(folder, "started.json")); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, "started.json"), "utf8")),
      { mode: null, features: null, unrelated: "keep" });
    assert.ok(fs.readFileSync(path.join(folder, ".env"), "utf8").includes('"off"'));
    assert.equal(fs.readdirSync(folder).filter(file => file.endsWith(".bak")).length, 1);
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
