import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createRotatingWorkerLog, createWorkerLineCapture } from "./rotating-worker-log";
import { createLogRedactor, redactLogValue } from "./worker-log-redaction.mjs";
import { collectWorkerDiagnostics } from "../scripts/collect-worker-diagnostics.mjs";
import { normalizeError } from "./logging";

function fixture(t: { after(fn: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "listflow-diagnostics-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "listflow-diagnostics-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("worker logs rotate within the disk budget and preserve the latest records", t => {
  const root = fixture(t);
  const file = path.join(root, "worker.log");
  const log = createRotatingWorkerLog(file, { maxBytes: 256, backups: 2 });
  for (let i = 0; i < 20; i++) assert.equal(log.write(`event-${i}: ${"x".repeat(80)}\n`), true);
  assert.equal(fs.readdirSync(root).length, 3);
  for (const name of fs.readdirSync(root)) assert.ok(fs.statSync(path.join(root, name)).size <= 256);
  assert.match(fs.readFileSync(file, "utf8"), /event-19/);
  assert.doesNotMatch(fs.readFileSync(`${file}.2`, "utf8"), /event-0:/);
  assert.equal(log.write("x".repeat(5000)), true);
  assert.ok(fs.statSync(file).size <= 256);
});

test("an unwritable log path does not crash the worker or flood error reports", t => {
  const root = fixture(t);
  const blocker = path.join(root, "not-a-directory");
  fs.writeFileSync(blocker, "fixture");
  let errors = 0;
  const log = createRotatingWorkerLog(path.join(blocker, "worker.log"), { onError() { errors++; } });
  for (let i = 0; i < 100; i++) assert.equal(log.write("event\n"), false);
  assert.equal(errors, 1);
});

test("old oversized logs are reduced to the retention budget", t => {
  const root = fixture(t);
  const file = path.join(root, "worker.log");
  fs.writeFileSync(file, "old event\n".repeat(1000));
  const log = createRotatingWorkerLog(file, { maxBytes: 256, backups: 2 });
  assert.equal(log.write("new event\n"), true);
  for (const name of fs.readdirSync(root)) assert.ok(fs.statSync(path.join(root, name)).size <= 256);
  assert.match(fs.readFileSync(file, "utf8"), /new event/);
});

test("console capture redacts secrets across chunks and preserves split UTF-8", () => {
  const redact = createLogRedactor({ EBAY_STORE1_TOKEN: "fixture-secret-123" });
  const lines: string[] = [];
  const capture = createWorkerLineCapture(line => lines.push(redact(line)), 256);
  const text = Buffer.from("error fixture-secret-123 বাংলাদেশ\nlast line");
  for (const byte of text) capture.write(Buffer.from([byte]));
  capture.end();
  assert.deepEqual(lines, ["error [REDACTED] বাংলাদেশ\n", "last line\n"]);
  capture.write(Buffer.from("z".repeat(500) + "\nok\n"));
  assert.match(lines.join(""), /Oversized console line omitted/);
  assert.equal(lines.at(-1), "ok\n");
});

test("redaction covers credentials in messages, stacks, JSON, URLs and XML", () => {
  const secret = "fixture-token&with/slashes";
  const redact = createLogRedactor({ EBAY_STORE1_TOKEN: secret, DATABASE_URL: "postgresql://worker:db-password@host/db" });
  const entry = redactLogValue({
    message: `Failure ${secret} ${encodeURIComponent(secret)}`,
    error: { stack: "Error db-password\n at task (lib/task.ts:20)", cause: { authorization: "Bearer hidden" } },
    jobId: "job-123", responseBody: "private response",
  }, redact);
  const result = JSON.stringify(entry);
  for (const value of [secret, encodeURIComponent(secret), "db-password", "private response", "Bearer hidden"]) assert.ok(!result.includes(value));
  assert.match(result, /job-123/);
  assert.match(result, /lib\/task.ts:20/);
  const generic = redact('postgresql://user:unknown-password@host/db Bearer unknown-token\n{"refresh_token":"unknown-json-token"}\n<eBayAuthToken>unknown-xml-token</eBayAuthToken>\nhttps://host/?api_key=unknown-key');
  for (const value of ["unknown-password", "unknown-token", "unknown-json-token", "unknown-xml-token", "unknown-key"]) assert.ok(!generic.includes(value));
});

test("normalized errors retain database and operating system error codes", () => {
  const error = Object.assign(new Error("connection unavailable"), { code: "ECONNRESET" });
  assert.equal(normalizeError(error)?.code, "ECONNRESET");
  assert.equal(normalizeError({ message: "missing column", code: "P2022" })?.code, "P2022");
});

test("the worker logger persists revision, correlation and redacted stack details", t => {
  const root = fixture(t);
  const loggerPath = path.resolve("lib/logger.ts");
  const program = `
    const Module = require('module');
    const original = Module._load;
    Module._load = function(name, ...args) { return name === 'server-only' ? {} : original.call(this, name, ...args); };
    process.chdir(${JSON.stringify(root)});
    const { logger } = require(${JSON.stringify(loggerPath)});
    const error = Object.assign(new Error('fixture-secret-auth'), { code: 'ECONNRESET' });
    logger.error('worker/test', 'Job failed fixture-secret-auth', error, undefined, { jobId: 'job-fixture', storeId: 'store-fixture' });
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", program], {
    cwd: process.cwd(), encoding: "utf8", timeout: 15000, windowsHide: true,
    env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"), LISTFLOW_WORKER_PROCESS: "true", LISTFLOW_WORKER_ID: "fixture-worker", LISTFLOW_REVISION: "fixture-revision", LISTFLOW_DISABLE_DB_LOGS: "true", LISTFLOW_DISABLE_FILE_LOGS: "false", EBAY_STORE1_TOKEN: "fixture-secret-auth", RAILWAY_ENVIRONMENT_NAME: "" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const text = fs.readFileSync(path.join(root, "logs", "events-fixture-worker.log"), "utf8");
  assert.ok(!text.includes("fixture-secret-auth"));
  const entry = JSON.parse(text);
  assert.equal(entry.error.code, "ECONNRESET");
  assert.match(entry.error.stack, /Error: \[REDACTED\]/);
  assert.equal(entry.revision, "fixture-revision");
  assert.equal(entry.workerId, "fixture-worker");
  assert.equal(entry.jobId, "job-fixture");
  assert.ok(entry.sessionId);
  assert.ok(entry.processId);
});

test("collector excludes environment files and unrelated logs, with useful errors and no dependencies", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "logs"));
  fs.writeFileSync(path.join(root, ".env"), 'EBAY_STORE1_TOKEN="fixture-private-token"\nDATABASE_URL="postgresql://u:fixture-password@host/db"\n');
  fs.writeFileSync(path.join(root, "logs", "worker-store-1-a.log"), 'Error fixture-private-token job-123\n');
  fs.writeFileSync(path.join(root, "logs", "events-local-store-1-a.log"), JSON.stringify({ timestamp: "2026-10-01T12:00:00Z", level: "ERROR", jobId: "job-123", message: "failed", error: { stack: "at importJob:20", token: "unconfigured-secret" } }) + "\n");
  fs.writeFileSync(path.join(root, "logs", "debug.log"), "do-not-collect\n");
  fs.writeFileSync(path.join(root, "logs", "local-store-1-a.worker.lock"), "99999999");
  const result = collectWorkerDiagnostics(root);
  const serialized = JSON.stringify(result);
  for (const value of ["fixture-private-token", "fixture-password", "unconfigured-secret", "do-not-collect"]) assert.ok(!serialized.includes(value));
  assert.match(serialized, /job-123/);
  assert.match(serialized, /at importJob:20/);
  assert.equal(result.configurationPresence.EBAY_STORE1_TOKEN, "present");
  assert.equal(result.logs.length, 2);
  assert.ok(result.recentIncidents.length >= 2);
  assert.equal(result.release.dependencyVersions.tsx.installed, null);
});

test("collector bounds old logs and drops incomplete credential fragments", t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "logs"));
  const file = path.join(root, "logs", "worker-store-1-a.log");
  fs.writeFileSync(file, "old-sensitive-fragment".repeat(20000) + "\nError retained\nBearer partial-secret");
  const result = collectWorkerDiagnostics(root);
  assert.equal(result.logs[0].truncated, true);
  assert.equal(result.logs[0].content, "Error retained\n");
  assert.ok(JSON.stringify(result).length < 15000);
});

test("Windows diagnostic launcher creates a ZIP even without node_modules", { skip: process.platform !== "win32" }, t => {
  const root = fixture(t);
  for (const dir of ["scripts", "lib", "logs"]) fs.mkdirSync(path.join(root, dir));
  for (const file of ["scripts/collect-worker-diagnostics.ps1", "scripts/collect-worker-diagnostics.mjs", "lib/worker-log-redaction.mjs"]) fs.copyFileSync(file, path.join(root, file));
  fs.writeFileSync(path.join(root, "logs", "worker-store-1-a.log"), "Error fixture failure\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "collect-worker-diagnostics.ps1")], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const files = fs.readdirSync(path.join(root, "diagnostics"));
  assert.equal(files.length, 1);
  assert.match(files[0], /\.zip$/);
  assert.equal(fs.readFileSync(path.join(root, "diagnostics", files[0])).subarray(0, 2).toString(), "PK");
});
