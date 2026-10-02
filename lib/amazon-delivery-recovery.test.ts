import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { applyAmazonDeliveryPostcode, AmazonDeliveryFailure, assertAmazonDeliveryPage } from "./amazon-delivery-recovery";

const html = '<input id="ASIN" value="B0G6CQ427S"><h1 id="productTitle">Test kettle</h1>';
function pageFixture(status = 200, popupError = "Timeout 5000ms exceeded", pageHtml = html) {
  const calls: Array<[string, unknown]> = [];
  const locator = (selector: string) => ({
    isVisible: async () => false,
    waitFor: async (options: unknown) => { calls.push([selector, options]); if (selector === "#GLUXZipUpdateInput") throw new Error(popupError); },
    click: async () => { calls.push(["click", selector]); if (popupError === "Click failed") throw new Error(popupError); },
  });
  const page = { content: async () => pageHtml, locator,
    evaluate: async (_fn: unknown, argument?: unknown) => {
      if (!argument) return "Sydney 2000";
      calls.push(["address-request", argument]);
      return { success: status === 200, status, contentType: status === 200 ? "text/html" : "text/plain",
        responseText: "unrecognized address response" };
    },
  } as unknown as Page;
  return { page, calls };
}

for (const status of [503, 429, 200]) test(`HTTP ${status} and popup timeout preserve both causes with one address request`, async () => {
  const fixture = pageFixture(status);
  await assert.rejects(applyAmazonDeliveryPostcode(fixture.page, "2217"), (error: unknown) => {
    assert.ok(error instanceof AmazonDeliveryFailure);
    assert.equal(error.code, "TECHNICAL_ERROR");
    assert.equal(error.details.httpStatus, status);
    assert.equal(error.details.requestedPostcode, "2217");
    assert.equal(error.details.observedDeliveryText, "Sydney 2000");
    assert.equal(error.details.stage, "popup-input");
    assert.match(error.details.browserError ?? "", /Timeout/);
    assert.equal(error.details.technicalCode, status === 200 ? "AMAZON_DELIVERY_POPUP_TIMEOUT" : "AMAZON_DELIVERY_HTTP_ERROR");
    assert.equal(error.details.addressFailureCode, status === 200 ? "AMAZON_DELIVERY_RESPONSE_UNRECOGNIZED" : "AMAZON_DELIVERY_HTTP_ERROR");
    assert.equal(error.permitsFreshContextRetry, status === 200);
    assert.doesNotMatch(error.message, /invalid postcode|invalid address/i);
    return true;
  });
  assert.equal(fixture.calls.filter(([name]) => name === "address-request").length, 1);
  assert.deepEqual(fixture.calls.filter(([name]) => name.startsWith("#")), [
    ["#nav-global-location-popover-link", { state: "visible", timeout: 3000 }],
    ["#GLUXZipUpdateInput", { state: "visible", timeout: 5000 }],
  ]);
});

test("failed click retains its stage and underlying browser error", async () => {
  const fixture = pageFixture(200, "Click failed");
  await assert.rejects(applyAmazonDeliveryPostcode(fixture.page, "2217"), (error: unknown) =>
    error instanceof AmazonDeliveryFailure && error.details.stage === "location-click" &&
    error.details.browserError === "Click failed" && error.details.technicalCode === "AMAZON_DELIVERY_POPUP_FAILED");
});

test("navigation HTTP errors retain status and content type before submitting an address", async () => {
  const fixture = pageFixture();
  await assert.rejects(assertAmazonDeliveryPage(fixture.page, "2217", { httpStatus: 503, contentType: "text/html" }),
    (error: unknown) => error instanceof AmazonDeliveryFailure && error.details.httpStatus === 503 &&
    error.details.contentType === "text/html" && error.details.stage === "product-navigation" && !error.permitsFreshContextRetry);
  assert.equal(fixture.calls.length, 0);
});

for (const [title, kind] of [["Robot Check", "CHALLENGE"], ["Server Busy", "TEMPORARY_ERROR"], ["Unknown", "UNRECOGNIZED"]]) {
  test(`${kind} stops before address submission`, async () => {
    const fixture = pageFixture(200, "", `<title>${title}</title>`);
    await assert.rejects(applyAmazonDeliveryPostcode(fixture.page, "2217"), (error: unknown) =>
      error instanceof AmazonDeliveryFailure && error.details.pageClassification === kind);
    assert.equal(fixture.calls.length, 0);
  });
}

test("HTTP 200 error-page diagnostics preserve safe page markers without HTML", async () => {
  const pageHtml = '<title>Server Busy</title><body>temporary error <script>secretCookie</script></body>';
  const fixture = pageFixture(200, "", pageHtml);
  await assert.rejects(assertAmazonDeliveryPage(fixture.page, "2217", { httpStatus: 200, contentType: "text/html" }), (error: unknown) => {
    assert.ok(error instanceof AmazonDeliveryFailure);
    assert.equal(error.details.httpStatus, 200);
    assert.deepEqual(error.details.pageEvidence, { documentTitle: "Server Busy", productTitle: null, detectedAsin: null,
      hasAsinInput: false, hasBuyBox: false, deliveryText: "", htmlBytes: Buffer.byteLength(pageHtml, "utf8") });
    assert.doesNotMatch(JSON.stringify(error.details), /secretCookie|<script>|<body>/);
    return true;
  });
  assert.equal(fixture.calls.length, 0);
});

test("accepted postcode request reports success without an unrecognized-response failure code", async () => {
  const events: Array<{ stage: string; technicalCode?: string }> = [];
  const fixture = pageFixture();
  const page = { ...fixture.page,
    evaluate: async (_fn: unknown, argument?: unknown) => argument
      ? { success: true, status: 200, contentType: "application/json", responseText: '{"isValidAddress":1}' }
      : "Sydney 2000",
  } as unknown as Page;
  assert.equal(await applyAmazonDeliveryPostcode(page, "2217", event => events.push(event)), true);
  const accepted = events.find(event => event.stage === "address-request-accepted");
  assert.ok(accepted);
  assert.equal(accepted.technicalCode, undefined);
});