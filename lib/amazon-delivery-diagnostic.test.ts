import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright-core";
import { withDeliveryDiagnosticProfile, withDeliveryNativeProfile, DELIVERY_DIAGNOSTIC_USER_AGENT } from "../scripts/amazon-delivery-repair-browser";

test("comparison controls only the diagnostic user agent and keeps browser methods bound", async () => {
  let actual: Parameters<Browser["newContext"]>[0];
  let closed = false;
  const browser = { identity: "native-browser", newContext: async function(options: typeof actual) {
    assert.equal(this.identity, "native-browser"); actual = options; return {};
  }, close: async function() { assert.equal(this.identity, "native-browser"); closed = true; },
  version: function() { assert.equal(this.identity, "native-browser"); return "149.0"; } };
  const controlled = withDeliveryDiagnosticProfile(browser as unknown as Browser);
  const options = { userAgent: "random-production-profile", locale: "en-AU", viewport: { width: 1920, height: 1080 },
    storageState: { cookies: [], origins: [] } };
  await controlled.newContext(options);
  assert.deepEqual(actual, { ...options, userAgent: DELIVERY_DIAGNOSTIC_USER_AGENT });
  assert.equal(options.userAgent, "random-production-profile");
  assert.equal(controlled.version(), "149.0");
  await controlled.close();
  assert.equal(closed, true);
});

test("native control omits profile spoofing and request hooks without changing production objects", async () => {
  let options: Parameters<Browser["newContext"]>[0];
  const page = { marker: "real-page", route: async () => { throw new Error("Native control must not intercept resources"); },
    addInitScript: async () => { throw new Error("Native control must not override browser properties"); },
    evaluate: async function() { assert.equal(this.marker, "real-page"); return "Actual Chrome user agent"; },
    title: async function() { assert.equal(this.marker, "real-page"); return "Product"; } };
  let closed = false;
  const context = { marker: "real-context", newPage: async function() { assert.equal(this.marker, "real-context"); return page; },
    close: async function() { assert.equal(this.marker, "real-context"); closed = true; } };
  const browser = { marker: "real-browser", newContext: async function(input: typeof options) {
    assert.equal(this.marker, "real-browser"); options = input; return context;
  } };
  const productionOptions = { userAgent: "spoofed-profile", viewport: { width: 1920, height: 1080 } };
  let userAgent: string | undefined;
  const control = withDeliveryNativeProfile(browser as unknown as Browser, value => { userAgent = value; });
  const controlledContext = await control.newContext(productionOptions);
  const controlledPage = await controlledContext.newPage();
  await controlledPage.route("**/*", () => {});
  await controlledPage.addInitScript(() => {});
  assert.equal(await controlledPage.title(), "Product");
  assert.deepEqual(options, { viewport: { width: 1920, height: 1080 } });
  assert.equal(productionOptions.userAgent, "spoofed-profile");
  assert.equal(userAgent, "Actual Chrome user agent");
  await assert.rejects(page.route(), /must not intercept/);
  await controlledContext.close();
  assert.equal(closed, true);
});
