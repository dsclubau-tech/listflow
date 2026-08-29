import assert from "node:assert/strict";
import test from "node:test";
import {
  getBrowserLaunchUserMessage,
  getScraperBrowserRuntime,
} from "./scraper-browser";

test("getScraperBrowserRuntime uses serverless Chromium on Vercel", () => {
  assert.equal(getScraperBrowserRuntime({ VERCEL: "1" }), "serverless");
});

test("getScraperBrowserRuntime keeps the manual worker on local Playwright", () => {
  assert.equal(
    getScraperBrowserRuntime({
      VERCEL: "1",
      LISTFLOW_USE_LOCAL_PLAYWRIGHT: "true",
    }),
    "local"
  );
});

test("getScraperBrowserRuntime supports an explicit serverless override", () => {
  assert.equal(
    getScraperBrowserRuntime({ LISTFLOW_USE_SERVERLESS_CHROMIUM: "1" }),
    "serverless"
  );
  assert.equal(getScraperBrowserRuntime({}), "local");
});

test("getBrowserLaunchUserMessage formats Playwright crash and close errors", () => {
  const launchCrashError = new Error(
    "browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n<launching> C:\\path\\chromium_headless_shell.exe"
  );
  assert.match(
    getBrowserLaunchUserMessage(launchCrashError) ?? "",
    /browser closed or crashed/i
  );

  const missingBinaryError = new Error(
    "Executable doesn't exist at C:\\path\\chrome.exe\nPlease run the following command to download new browsers: npx playwright install"
  );
  assert.match(
    getBrowserLaunchUserMessage(missingBinaryError) ?? "",
    /browser executable was not found/i
  );

  assert.equal(getBrowserLaunchUserMessage(new Error("Network timeout")), null);
});

