import assert from "node:assert/strict";
import test, { before, after, beforeEach, type TestContext } from "node:test";
import { chromium, type Browser } from "playwright-core";
import { emptyDeliveryBrowser } from "../tests/helpers/amazon-empty-delivery-browser";
import { scrapeAmazonPrice } from "./amazon-scraper";
import { evaluateAmazonShipping } from "./amazon-shipping-evidence";
import { emptyDeliveryProducts, emptyDeliveryOffer } from "../tests/fixtures/amazon-shipping-offers";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
beforeEach(context => { (context as TestContext).mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-09T01:00:00Z") }); });

for (const product of emptyDeliveryProducts) for (const sharedSnapshot of [false, true]) {
  test(`empty delivery recovery for ${product.asin}, snapshot ${sharedSnapshot}`, async () => {
    const fixture = emptyDeliveryBrowser(browser, product.asin);
    const result = await scrapeAmazonPrice(product.asin, fixture.browser, "2217", "REGULAR", null, { sharedSnapshot, captureImportPage: true });
    assert.equal(result.shippingEvidence?.outcome, "VERIFIED");
    assert.equal(result.shippingEvidence?.arrivalLatest, `2026-10-${product.asin === "B0FQ2JCQBR" ? "18" : "19"}`);
    assert.equal(evaluateAmazonShipping(result.shippingEvidence, 25, new Date()).arrivalDays, product.days);
    assert.equal(result.price, product.price);
    assert.match(result.importPageHtml!, /FREE International delivery/);
    assert.equal(fixture.state().navigations, 2);
    assert.equal(fixture.state().resourceLoads, 1);
    assert.deepEqual(fixture.state().reloadTimeouts, [20000]);
    assert.deepEqual(fixture.state().errors, []);
    assert.equal(fixture.state().pages, 0);
  });
}

const monitor = emptyDeliveryProducts[0];
test("ordinary delivery needs no reload", async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, () => emptyDeliveryOffer(monitor.asin, true));
  const result = await scrapeAmazonPrice(monitor.asin, f.browser, "2217");
  assert.equal(result.shippingEvidence?.outcome, "VERIFIED");
  assert.equal(f.state().navigations, 1);
  assert.equal(f.state().resourceLoads, 0);
  assert.deepEqual(f.state().errors, []);
});
test("continued emptiness performs one fallback and remains unknown", async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, html => html.replace(/<img[^>]+>/, ""));
  const stages: string[] = [];
  let readinessMs = 0, readinessStartedAt = 0;
  const result = await scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", null, { onTiming: stage => { stages.push(stage); if (stage === "empty-delivery-navigation") readinessStartedAt = performance.now(); if (stage === "empty-delivery-readiness") readinessMs = performance.now() - readinessStartedAt; } });
  assert.equal(result.shippingEvidence?.outcome, "UNKNOWN");
  assert.equal(f.state().navigations, 2);
  assert.ok(stages.includes("empty-delivery-still-empty"));
  assert.ok(readinessMs >= 8000 && readinessMs < 9000, "readiness must stop at its bounded deadline");
  assert.deepEqual(f.state().errors, []);
});
for (const [name, transform] of [
  ["missing container", (html: string) => html.replace('id="deliveryBlockMessage"', 'id="unsupported-delivery"')],
  ["nonempty unparseable promise", (html: string) => html.replace('<div id="deliveryBlockMessage"> </div>', '<div id="deliveryBlockMessage">Ask seller for delivery details</div>')],
  ["conflicting ordinary promises", (html: string) => html.replace('<div id="deliveryBlockMessage"> </div>', '<div id="deliveryBlockMessage"><div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE">Delivery 18 October</div><div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_SMALL">Delivery 20 October</div></div>')],
  ["conflicting dispatch", (html: string) => html.replace('In stock', 'Usually dispatched within 2 days').replace('</button>', '</button><div data-csa-c-availability="dispatch">Ships within 4 days</div>')],
  ["excessive dispatch", (html: string) => html.replace('In stock', 'Usually dispatched within 26 days')],
] as const) test(`${name} does not trigger empty delivery recovery`, async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, html => transform(html).replace(/<img[^>]+>/, ""));
  const result = await scrapeAmazonPrice(monitor.asin, f.browser, "2217");
  assert.equal(f.state().navigations, 1);
  assert.equal(result.shippingEvidence?.outcome, "UNKNOWN");
  assert.deepEqual(f.state().errors, []);
});
for (const [name, transform] of [
  ["ASIN redirect", (html: string) => html.replace('value="B0FQ2JCQBR"', 'value="B0OTHER123"')],
  ["postcode mismatch", (html: string) => html.replace('Kogarah 2217', 'Kogarah 2000')],
  ["unavailable buy box", (html: string) => html.replace('In stock', 'Currently unavailable').replace('id="add-to-cart-button"', 'id="unsupported-purchase"')],
  ["challenge page", () => '<html><title>Amazon CAPTCHA</title><body>Enter the characters you see below</body></html>'],
] as const) test(`recovery rejects ${name} without returning the old observation`, async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, (html, n) => n === 1 ? html : transform(html));
  await assert.rejects(scrapeAmazonPrice(monitor.asin, f.browser, "2217"));
  assert.equal(f.state().navigations, 2);
  assert.equal(f.state().pages, 0);
  assert.deepEqual(f.state().errors, []);
});
test("recovery recalculates price and shipping fee from the final page", async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, (html, n) => n === 1 ? html :
    html.replace('$182.76', '$199.00').replace('FREE International delivery', '$4.95 delivery'));
  const result = await scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", null, { captureImportPage: true });
  assert.equal(result.rawPrice, 199);
  assert.equal(result.shippingPrice, 4.95);
  assert.equal(result.price, 203.95);
  assert.match(result.importPageHtml!, /199.00/);
  assert.deepEqual(f.state().errors, []);
});
test("abort during recovery closes the context and stops extra writes", async () => {
  const controller = new AbortController();
  const f = emptyDeliveryBrowser(browser, monitor.asin);
  await assert.rejects(scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", null, {
    signal: controller.signal, onTiming: stage => { if (stage === "empty-delivery-attempted") controller.abort(); },
  }));
  assert.equal(f.state().navigations, 1);
  assert.equal(f.state().pages, 0);
  assert.deepEqual(f.state().errors, []);
});

test("recovery rechecks the saved variation after reload", async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, (html, n) => html.replace('</body>',
    '<div id="variation_color_name"><span class="selection">' + (n === 1 ? 'Black' : 'Blue') + '</span></div></body>'));
  const result = await scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", { colour: "Black" });
  assert.equal(result.variantSelectionFailed, true);
  assert.equal(result.price, null);
  assert.equal(result.shippingEvidence, undefined);
  assert.equal(f.state().navigations, 2);
  assert.deepEqual(f.state().errors, []);
});
test("caller timeout interrupts recovery readiness and closes the context", async () => {
  const controller = new AbortController();
  const f = emptyDeliveryBrowser(browser, monitor.asin, html => html.replace(/<img[^>]+>/, ""));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", null, {
      signal: controller.signal, onTiming: stage => {
        if (stage === "empty-delivery-navigation") timer = setTimeout(() => controller.abort(new Error("Caller deadline")), 100);
      },
    }));
    assert.equal(f.state().navigations, 2);
    assert.equal(f.state().pages, 0);
    assert.deepEqual(f.state().errors, []);
  } finally { clearTimeout(timer); }
});

test("failed fallback navigation remains a technical failure", async () => {
  const f = emptyDeliveryBrowser(browser, monitor.asin, undefined, true);
  const stages: string[] = [];
  await assert.rejects(scrapeAmazonPrice(monitor.asin, f.browser, "2217", "REGULAR", null, { onTiming: stage => stages.push(stage) }),
    (error: unknown) => (error as {code?:string}).code === "TECHNICAL_ERROR");
  assert.ok(stages.includes("empty-delivery-failed"));
  assert.equal(f.state().navigations, 2);
  assert.equal(f.state().pages, 0);
  assert.deepEqual(f.state().errors, []);
});
