import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForAmazonReadinessOrFallback } from "./amazon-readiness-waits";

test("readiness signal avoids the fixed fallback wait", async () => {
  let fallbackCalls = 0;
  const result = await waitForAmazonReadinessOrFallback({
    enabled: true,
    waitForSignal: async () => true,
    waitFallback: async () => { fallbackCalls += 1; },
  });

  assert.equal(result, "signal");
  assert.equal(fallbackCalls, 0);
});

test("readiness timeout retains the original fallback wait", async () => {
  let fallbackCalls = 0;
  const result = await waitForAmazonReadinessOrFallback({
    enabled: true,
    waitForSignal: async () => false,
    waitFallback: async () => { fallbackCalls += 1; },
  });

  assert.equal(result, "fallback");
  assert.equal(fallbackCalls, 1);
});

test("disabled readiness waits use only the original fallback", async () => {
  let signalCalls = 0;
  let fallbackCalls = 0;
  const result = await waitForAmazonReadinessOrFallback({
    enabled: false,
    waitForSignal: async () => { signalCalls += 1; return true; },
    waitFallback: async () => { fallbackCalls += 1; },
  });

  assert.equal(result, "fallback");
  assert.equal(signalCalls, 0);
  assert.equal(fallbackCalls, 1);
});
