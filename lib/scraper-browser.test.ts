import assert from "node:assert/strict";
import test from "node:test";
import { getScraperBrowserRuntime } from "./scraper-browser";

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
