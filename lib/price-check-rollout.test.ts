import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "dotenv";
import { configurePostcodeReuseEnvironment } from "./price-check-rollout";
import { resolvePriceCheckOptimizationConfig } from "./price-check-optimizations";
import { getPriceCheckProductDelayMs, resolvePriceCheckProductPacing } from "./price-check-pacing";

test("rollout enables RK only despite existing general three-store allowlist", () => {
  const original = 'UNRELATED="preserve"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="rk,oz,aussie"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATIONS="shared-snapshot"\r\n';
  const result = configurePostcodeReuseEnvironment(original, "rk", "enable");
  const environment = parse(result.text);
  assert.equal(environment.UNRELATED, "preserve");
  assert.equal(environment.LISTFLOW_PRICE_CHECK_TIMING_ENABLED, "true");
  assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", environment).enabled, ["shared-snapshot", "delivery-state"]);
  assert.deepEqual(resolvePriceCheckOptimizationConfig("oz", environment).enabled, ["shared-snapshot"]);
  assert.ok(result.text.includes("\r\n"));
  assert.equal(configurePostcodeReuseEnvironment(result.text, "rk", "enable").text, result.text);
});

test("baseline changes timing only; rollback preserves other optimizations", () => {
  const original = 'LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="rk"\nLISTFLOW_PRICE_CHECK_OPTIMIZATIONS="shared-snapshot"\n';
  const baseline = configurePostcodeReuseEnvironment(original, "rk", "baseline");
  assert.deepEqual(baseline.updates, { LISTFLOW_PRICE_CHECK_TIMING_ENABLED: "true" });
  const enabled = configurePostcodeReuseEnvironment(baseline.text, "rk", "enable");
  const disabled = configurePostcodeReuseEnvironment(enabled.text, "rk", "disable");
  assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", parse(disabled.text)).enabled, ["shared-snapshot"]);
  assert.throws(() => configurePostcodeReuseEnvironment('LISTFLOW_PRICE_CHECK_OPTIMIZATIONS="typo"', "rk", "enable"));
});

test("rollout preserves stores that already have delivery-state enabled", () => {
  const original = 'LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="oz"\nLISTFLOW_PRICE_CHECK_OPTIMIZATIONS="delivery-state"\n';
  const enabled = configurePostcodeReuseEnvironment(original, "rk", "enable");
  assert.deepEqual(resolvePriceCheckOptimizationConfig("oz", parse(enabled.text)).enabled, ["delivery-state"]);
  const disabled = configurePostcodeReuseEnvironment(enabled.text, "rk", "disable");
  assert.deepEqual(resolvePriceCheckOptimizationConfig("oz", parse(disabled.text)).enabled, ["delivery-state"]);
  assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", parse(disabled.text)).enabled, []);
});

test("comparison pacing matches checker defaults and configured bounds", () => {
  assert.deepEqual(resolvePriceCheckProductPacing({}), { minMs: 3000, maxMs: 7000 });
  const pacing = resolvePriceCheckProductPacing({
    LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS: "1500", LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS: "3500",
  });
  assert.equal(getPriceCheckProductDelayMs(pacing, () => 0), 1500);
  assert.equal(getPriceCheckProductDelayMs(pacing, () => 0.5), 2500);
  assert.deepEqual(resolvePriceCheckProductPacing({
    LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS: "-1", LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS: "500",
  }), { minMs: 1000, maxMs: 1000 });
});
test("all mode covers future stores and leaves other feature allowlists intact", () => {
  const original = 'UNRELATED="preserve"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="rk"\r\nLISTFLOW_PRICE_CHECK_OPTIMIZATIONS="shared-snapshot"\r\n';
  const enabled = configurePostcodeReuseEnvironment(original, undefined, "all");
  const environment = parse(enabled.text);
  assert.equal(environment.UNRELATED, "preserve");
  assert.equal(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS, "rk");
  assert.equal(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE, "all");
  for (const id of ["rk", "aussie", "oz", "future"]) {
    assert.equal(resolvePriceCheckOptimizationConfig(id, environment).deliveryStateEnabled, true);
  }
  assert.deepEqual(resolvePriceCheckOptimizationConfig("oz", environment).enabled, ["delivery-state"]);
  assert.equal(configurePostcodeReuseEnvironment(enabled.text, undefined, "all").text, enabled.text);
});

test("all-mode per-store rollback and re-enable preserve every other store and feature", () => {
  const original = 'LISTFLOW_PRICE_CHECK_OPTIMIZATIONS="progress-write,delivery-state"\nLISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS="rk"\nLISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE="all"\nLISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS="already-excluded"\n';
  const disabled = configurePostcodeReuseEnvironment(original, "aussie", "disable");
  assert.equal(configurePostcodeReuseEnvironment(disabled.text, "aussie", "disable").text, disabled.text);
  assert.equal(parse(disabled.text).LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS, "rk");
  assert.equal(resolvePriceCheckOptimizationConfig("aussie", parse(disabled.text)).deliveryStateEnabled, false);
  assert.equal(resolvePriceCheckOptimizationConfig("oz", parse(disabled.text)).deliveryStateEnabled, true);
  const enabled = configurePostcodeReuseEnvironment(disabled.text, "aussie", "enable");
  assert.equal(resolvePriceCheckOptimizationConfig("aussie", parse(enabled.text)).deliveryStateEnabled, true);
  assert.equal(resolvePriceCheckOptimizationConfig("already-excluded", parse(enabled.text)).deliveryStateEnabled, false);
  const off = configurePostcodeReuseEnvironment(enabled.text, undefined, "off");
  assert.equal(configurePostcodeReuseEnvironment(off.text, undefined, "off").text, off.text);
  assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", parse(off.text)).enabled, ["progress-write"]);
  const restored = configurePostcodeReuseEnvironment(off.text, undefined, "all");
  assert.equal(resolvePriceCheckOptimizationConfig("future", parse(restored.text)).deliveryStateEnabled, true);
  assert.equal(resolvePriceCheckOptimizationConfig("already-excluded", parse(restored.text)).deliveryStateEnabled, false);
});

test("configuration commands reject invalid inputs before writing and repair mode explicitly", () => {
  assert.throws(() => configurePostcodeReuseEnvironment("", undefined, "enable"), /database store ID/);
  assert.throws(() => configurePostcodeReuseEnvironment("", 'store\"\nINJECTED=1', "disable"), /database store ID/);
  assert.throws(() => configurePostcodeReuseEnvironment('LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE="typo"', "rk", "enable"), /Invalid existing/);
  const repaired = configurePostcodeReuseEnvironment('LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE="typo"', undefined, "off");
  assert.equal(parse(repaired.text).LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE, "off");
  assert.throws(() => configurePostcodeReuseEnvironment('LISTFLOW_PRICE_CHECK_OPTIMIZATIONS="typo"', undefined, "all"), /Unknown/);
});

test("explicit legacy exclusions can be cleared without changing the other exclusions", () => {
  const enabled = configurePostcodeReuseEnvironment('LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS="rk,oz"\n', "rk", "enable");
  assert.equal(resolvePriceCheckOptimizationConfig("rk", parse(enabled.text)).deliveryStateEnabled, true);
  assert.equal(parse(enabled.text).LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS, "oz");
});
