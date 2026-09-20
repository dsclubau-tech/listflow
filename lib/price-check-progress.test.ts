import assert from "node:assert/strict";
import { test } from "node:test";
import { reportCompletedProductCallbacks } from "./price-check-progress";

test("legacy completion reports progress before the checkpoint", async () => {
  const calls: string[] = [];
  await reportCompletedProductCallbacks({
    completionIncludesProgress: false,
    reportProgress: async () => { calls.push("progress"); },
    reportCompletion: async () => { calls.push("completion"); },
    onCompletionError: () => { calls.push("error"); },
  });
  assert.deepEqual(calls, ["progress", "completion"]);
});

test("consolidated completion writes only the checkpoint", async () => {
  const calls: string[] = [];
  await reportCompletedProductCallbacks({
    completionIncludesProgress: true,
    reportProgress: async () => { calls.push("progress"); },
    reportCompletion: async () => { calls.push("completion"); },
    onCompletionError: () => { calls.push("error"); },
  });
  assert.deepEqual(calls, ["completion"]);
});

test("consolidated completion falls back to progress after a checkpoint error", async () => {
  const calls: string[] = [];
  await reportCompletedProductCallbacks({
    completionIncludesProgress: true,
    reportProgress: async () => { calls.push("progress"); },
    reportCompletion: async () => {
      calls.push("completion");
      throw new Error("checkpoint unavailable");
    },
    onCompletionError: () => { calls.push("error"); },
  });
  assert.deepEqual(calls, ["completion", "error", "progress"]);
});

test("missing completion callback always retains progress reporting", async () => {
  let progressCalls = 0;
  await reportCompletedProductCallbacks({
    completionIncludesProgress: true,
    reportProgress: async () => { progressCalls += 1; },
    onCompletionError: () => {},
  });
  assert.equal(progressCalls, 1);
});
