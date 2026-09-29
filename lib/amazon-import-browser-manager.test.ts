import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright-core";
import { acquireImportBrowser, closeImportBrowser } from "@/lib/amazon-import-browser-manager";

test("import browser stays warm while delivery state stays scoped to store and postcode", async () => {
  let launches = 0;
  let closes = 0;
  const fake = {
    isConnected: () => true,
    close: async () => { closes += 1; },
  } as unknown as Browser;
  const launch = async () => { launches += 1; return fake; };
  try {
    const first = await acquireImportBrowser("store-a", "2217", launch);
    const firstState = first.deliveryState;
    await first.release();
    const same = await acquireImportBrowser("store-a", "2217", launch);
    assert.equal(same.browser, fake);
    assert.equal(same.deliveryState, firstState);
    await same.release();
    const otherStore = await acquireImportBrowser("store-b", "2217", launch);
    assert.notEqual(otherStore.deliveryState, firstState);
    await otherStore.release();
    const changedPostcode = await acquireImportBrowser("store-a", "3175", launch);
    assert.notEqual(changedPostcode.deliveryState, firstState);
    assert.equal(launches, 1);
    await changedPostcode.release();
  } finally {
    await closeImportBrowser();
  }
  assert.equal(closes, 1);
});
