import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PriceCheckTimingRecorder,
  resolvePriceCheckOptimizationConfig,
} from "./price-check-optimizations";

describe("price-check optimization configuration", () => {
  test("defaults every optimization and timing to off", () => {
    const config = resolvePriceCheckOptimizationConfig("store-1", {});
    assert.equal(config.timingEnabled, false);
    assert.deepEqual(config.enabled, []);
  });

  test("requires the current store to be explicitly allowed", () => {
    const environment = {
      LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "progress-write,shared-snapshot",
      LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "store-2",
    };

    assert.deepEqual(
      resolvePriceCheckOptimizationConfig("store-1", environment).enabled,
      [],
    );
    assert.deepEqual(
      resolvePriceCheckOptimizationConfig("store-2", environment).enabled,
      ["progress-write", "shared-snapshot"],
    );
  });

  test("an unknown feature disables every requested optimization", () => {
    const config = resolvePriceCheckOptimizationConfig("store-1", {
      LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "progress-write,typo",
      LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "store-1",
    });

    assert.deepEqual(config.unknown, ["typo"]);
    assert.deepEqual(config.enabled, []);
  });

  test("timing is independent from optimization allowlists", () => {
    const config = resolvePriceCheckOptimizationConfig("store-1", {
      LISTFLOW_PRICE_CHECK_TIMING_ENABLED: "true",
    });
    assert.equal(config.timingEnabled, true);
    assert.deepEqual(config.enabled, []);
  });

  test("delivery-state canary scope preserves other features for other allowed stores", () => {
    const environment = {
      LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "shared-snapshot,delivery-state",
      LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "store-1,store-2",
      LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS: "store-1",
    };
    assert.deepEqual(resolvePriceCheckOptimizationConfig("store-1", environment).enabled,
      ["shared-snapshot", "delivery-state"]);
    assert.deepEqual(resolvePriceCheckOptimizationConfig("store-2", environment).enabled,
      ["shared-snapshot"]);
    assert.deepEqual(resolvePriceCheckOptimizationConfig("store-1", {
      ...environment, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS: "",
    }).enabled, ["shared-snapshot"]);
    assert.deepEqual(resolvePriceCheckOptimizationConfig("other-store", environment).enabled, []);
  });
});

test("timing recorder is inert when disabled", () => {
  const recorder = new PriceCheckTimingRecorder(false);
  recorder.record("navigation", 10);
  recorder.increment("scrapes");
  assert.deepEqual(recorder.snapshot().stages, {});
  assert.deepEqual(recorder.snapshot().counters, {});
});

describe("postcode reuse across existing and future stores", () => {
  const all = {
    LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "progress-write,shared-snapshot,delivery-state",
    LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "rk",
    LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS: "rk",
    LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: "all",
  };
  test("all mode enables every identified store while other features stay scoped", () => {
    for (const id of ["rk", "aussie", "oz", "future-store"]) {
      const config = resolvePriceCheckOptimizationConfig(id, all);
      assert.equal(config.deliveryStateEnabled, true);
      assert.deepEqual(config.enabled, id === "rk"
        ? ["progress-write", "shared-snapshot", "delivery-state"] : ["delivery-state"]);
    }
    assert.equal(resolvePriceCheckOptimizationConfig("future", {
      ...all, LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: "",
      LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS: "",
    }).deliveryStateEnabled, true);
  });
  test("all mode still requires the requested feature and respects exclusions", () => {
    const environment = { ...all, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS: "aussie, rk,aussie" };
    assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", environment).enabled, ["progress-write", "shared-snapshot"]);
    assert.equal(resolvePriceCheckOptimizationConfig("aussie", environment).deliveryStateEnabled, false);
    assert.equal(resolvePriceCheckOptimizationConfig("oz", environment).deliveryStateEnabled, true);
    assert.equal(resolvePriceCheckOptimizationConfig("oz", {
      ...all, LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "shared-snapshot",
    }).deliveryStateEnabled, false);
  });
  test("off mode and exclusions in legacy mode preserve other optimization behavior", () => {
    assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", {
      ...all, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: "off",
    }).enabled, ["progress-write", "shared-snapshot"]);
    const legacy = { ...all, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: "allowlist",
      LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS: "rk" };
    assert.deepEqual(resolvePriceCheckOptimizationConfig("rk", legacy).enabled, ["progress-write", "shared-snapshot"]);
  });
  test("invalid modes and missing store identity never create reusable sessions", () => {
    for (const mode of ["invalid", ""]) {
      const config = resolvePriceCheckOptimizationConfig("rk", {
        ...all, LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE: mode,
      });
      assert.equal(config.deliveryStateMode, null);
      assert.match(config.deliveryStateConfigurationIssue!, /Invalid/);
      assert.deepEqual(config.enabled, ["progress-write", "shared-snapshot"]);
    }
    for (const id of [undefined, "", "   "]) {
      const config = resolvePriceCheckOptimizationConfig(id, all);
      assert.equal(config.deliveryStateEnabled, false);
      assert.match(config.deliveryStateConfigurationIssue!, /identity/);
      assert.deepEqual(config.enabled, []);
    }
    assert.deepEqual(resolvePriceCheckOptimizationConfig("oz", {
      ...all, LISTFLOW_PRICE_CHECK_OPTIMIZATIONS: "delivery-state,typo",
    }).enabled, []);
  });
});
