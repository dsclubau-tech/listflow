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
});

test("timing recorder is inert when disabled", () => {
  const recorder = new PriceCheckTimingRecorder(false);
  recorder.record("navigation", 10);
  recorder.increment("scrapes");
  assert.deepEqual(recorder.snapshot().stages, {});
  assert.deepEqual(recorder.snapshot().counters, {});
});
