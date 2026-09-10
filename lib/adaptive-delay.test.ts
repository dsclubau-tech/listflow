import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveDelay } from "@/lib/adaptive-delay";

test("AdaptiveDelay initializes at minMs", () => {
  const throttle = new AdaptiveDelay(3000, 30000);
  assert.equal(throttle.delayMs, 3000);
  assert.equal(throttle.failures, 0);
});

test("AdaptiveDelay never drops below minMs on fast scrapes", () => {
  const throttle = new AdaptiveDelay(3000, 30000);
  // Extremely fast scrape (100ms)
  throttle.onSuccess(100);
  assert.ok(throttle.delayMs >= 3000);
  assert.equal(throttle.failures, 0);
});

test("AdaptiveDelay scales up on longer latency responses", () => {
  const throttle = new AdaptiveDelay(1000, 30000);
  // 3000ms latency with scale 1.5 -> target 4500ms
  // Blending from 1000ms with rate 0.8: 1000 * 0.8 + 4500 * 0.2 = 1700ms
  throttle.onSuccess(3000);
  assert.ok(throttle.delayMs > 1000);
  assert.ok(throttle.delayMs <= 30000);
});

test("AdaptiveDelay multiplies delay on failure", () => {
  const throttle = new AdaptiveDelay(3000, 30000);
  throttle.onFailure();
  assert.equal(throttle.delayMs, 6000);
  assert.equal(throttle.failures, 1);

  throttle.onFailure();
  assert.equal(throttle.delayMs, 12000);
  assert.equal(throttle.failures, 2);
});

test("AdaptiveDelay caps at maxMs on repeated failures", () => {
  const throttle = new AdaptiveDelay(3000, 30000);
  for (let i = 0; i < 10; i++) {
    throttle.onFailure();
  }
  assert.equal(throttle.delayMs, 30000);
  assert.equal(throttle.failures, 10);
});

test("AdaptiveDelay gradually recovers delay and resets failure count on success", () => {
  const throttle = new AdaptiveDelay(3000, 30000);
  // Cause 3 failures -> 24000ms
  throttle.onFailure();
  throttle.onFailure();
  throttle.onFailure();
  assert.equal(throttle.delayMs, 24000);
  assert.equal(throttle.failures, 3);

  // First success -> failure count resets to 0, delay starts declining
  throttle.onSuccess(1000);
  assert.equal(throttle.failures, 0);
  assert.ok(throttle.delayMs < 24000);

  // After sustained successes, delay recovers back down to minMs
  for (let i = 0; i < 40; i++) {
    throttle.onSuccess(1000);
  }
  assert.equal(throttle.delayMs, 3000);
});
