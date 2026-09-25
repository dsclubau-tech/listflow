import { expect, test } from "playwright/test";
import { buildSync } from "esbuild";

declare global {
  interface Window {
    pollingHarness: {
      state: { calls: number; inFlight: number; maxInFlight: number };
      setActive(value: boolean): void;
      setHold(value: boolean): void;
      requestNow(): void;
      unmount(): void;
    };
  }
}

const harness = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { useAdaptivePolling } from "./hooks/useAdaptivePolling.ts";
      const state = { calls: 0, inFlight: 0, maxInFlight: 0, hold: false, active: false };
      let setActive;
      function App() {
        const [active, updateActive] = React.useState(false);
        setActive = updateActive;
        const requestNow = useAdaptivePolling({
          resourceKey: "test-job",
          active,
          immediateOnMount: true,
          poll: async (signal) => {
            state.calls += 1;
            state.inFlight += 1;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            try {
              if (state.hold) await new Promise((resolve) => {
                if (signal.aborted) resolve();
                else signal.addEventListener("abort", resolve, { once: true });
              });
            } finally {
              state.inFlight -= 1;
            }
          },
        });
        window.pollingHarness.requestNow = requestNow;
        return null;
      }
      window.pollingHarness = {
        state,
        setActive(value) { setActive(value); },
        setHold(value) { state.hold = value; },
      };
      const root = createRoot(document.getElementById("root"));
      root.render(React.createElement(App));
      window.pollingHarness.unmount = () => root.unmount();
    `,
    loader: "js",
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  write: false,
});

test("job polling adapts to activity and pauses while hidden", async ({ page }) => {
  await page.clock.install();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: harness.outputFiles[0].text });
  const calls = () => page.evaluate(() => window.pollingHarness.state.calls);
  await expect.poll(calls).toBe(1);

  await page.clock.fastForward(30_000);
  await expect.poll(calls).toBe(2);
  await page.evaluate(() => window.pollingHarness.setActive(true));
  await page.clock.fastForward(2_000);
  await expect.poll(calls).toBeGreaterThan(2);
  const activeCalls = await calls();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30_000);
  expect(await calls()).toBe(activeCalls);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(1);
  await expect.poll(calls).toBe(activeCalls + 1);
});

test("slow polling requests never overlap and stop on unmount", async ({ page }) => {
  await page.clock.install();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: harness.outputFiles[0].text });
  await expect.poll(() => page.evaluate(() => window.pollingHarness.state.calls)).toBe(1);
  await page.evaluate(() => {
    const harness = window.pollingHarness;
    harness.setHold(true);
    harness.requestNow();
  });
  await page.clock.fastForward(30_000);
  const state = await page.evaluate(() => window.pollingHarness.state);
  expect(state.maxInFlight).toBe(1);
  await page.evaluate(() => window.pollingHarness.unmount());
  const before = await page.evaluate(() => window.pollingHarness.state.calls);
  await page.clock.fastForward(30_000);
  expect(await page.evaluate(() => window.pollingHarness.state.calls)).toBe(before);
});
