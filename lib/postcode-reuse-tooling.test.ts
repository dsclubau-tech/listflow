import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { getPriceCheckOptimizationEnvironmentSummary, resolvePriceCheckOptimizationConfig } from "./price-check-optimizations";
import { parse } from "dotenv";
import { verifyPostcodeReuseComparison } from "./postcode-reuse-rollout-verification";

test("CLI dry-run, atomic write, invalid input, and rollback preserve unrelated settings", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "listflow-postcode-cli-"));
  const file = path.join(folder, ".env");
  const initial = 'UNRELATED="secret-must-not-print"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATIONS="shared-snapshot"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="rk"\r\n';
  const execute = (...args: string[]) => spawnSync(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/configure-postcode-reuse.ts", "--env-file", file, ...args,
  ], { encoding: "utf8" });
  try {
    fs.writeFileSync(file, initial);
    const preview = execute("--mode", "all");
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(fs.readFileSync(file, "utf8"), initial);
    assert.ok(!preview.stdout.includes("secret-must-not-print"));
    const written = execute("--mode", "all", "--write");
    assert.equal(written.status, 0, written.stderr);
    const enabled = fs.readFileSync(file, "utf8");
    assert.equal(resolvePriceCheckOptimizationConfig("future", parse(enabled)).deliveryStateEnabled, true);
    assert.equal(parse(enabled).UNRELATED, "secret-must-not-print");
    assert.equal(execute("--mode", "disable", "--write").status, 1);
    assert.equal(fs.readFileSync(file, "utf8"), enabled);
    assert.equal(execute("--mode", "disable", "--store-id", "oz", "--write").status, 0);
    assert.equal(resolvePriceCheckOptimizationConfig("oz", parse(fs.readFileSync(file, "utf8"))).deliveryStateEnabled, false);
    assert.equal(execute("--mode", "off", "--write").status, 0);
    assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", parse(fs.readFileSync(file, "utf8"))).enabled, ["shared-snapshot"]);
    assert.equal(fs.readdirSync(folder).filter(name => name.endsWith(".tmp")).length, 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("summaries expose per-store effective state without affecting general feature scope", () => {
  const summary = getPriceCheckOptimizationEnvironmentSummary({
    LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "shared-snapshot,delivery-state",
    LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "rk",
    LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: "all",
    LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS: "oz",
  }, ["rk", "aussie", "oz", "future", "rk"]);
  assert.equal(summary.stores.length, 4);
  assert.deepEqual(summary.stores.map(store => store.deliveryStateEnabled), [true, true, false, true]);
  assert.deepEqual(summary.stores[1].enabled, ["delivery-state"]);
  assert.match(summary.stores[2].deliveryStateDisabledReason!, /excluded/);
});

function healthyReport() {
  return { products: 30, matches: 30, mismatches: 0, optimizations: ["delivery-state"],
    deliveryEvents: ["1:setup", "1:seeded", "2:reused"],
    comparisons: Array.from({ length: 30 }, () => ({ match: true,
      experiment: { outcome: { kind: "result", postcodeVerified: true, price: 12 } } })) };
}
test("activation evidence requires complete matches and real verified reuse", () => {
  assert.doesNotThrow(() => verifyPostcodeReuseComparison(healthyReport()));
  assert.throws(() => verifyPostcodeReuseComparison({ ...healthyReport(), mismatches: 1 }), /Every product/);
  assert.throws(() => verifyPostcodeReuseComparison({ ...healthyReport(), comparisons: [] }), /Every product/);
  assert.throws(() => verifyPostcodeReuseComparison({ ...healthyReport(), optimizations: ["delivery-state", "shared-snapshot"] }), /alone/);
  assert.throws(() => verifyPostcodeReuseComparison({ ...healthyReport(), deliveryEvents: [] }), /demonstrate/);
  assert.throws(() => verifyPostcodeReuseComparison({ ...healthyReport(),
    comparisons: Array.from({ length: 30 }, () => ({ match: true, experiment: { outcome: { kind: "error" } } })),
  }), /demonstrate/);
});
