import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { scrapeAmazonPrice } from "../lib/amazon-scraper";
import { PriceCheckFailure } from "../lib/price-check-failures";
import { AmazonDeliveryFailure } from "../lib/amazon-delivery-recovery";
let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
function fixture(asin: string, postcode: string, showPopup: boolean, missingPriceWithRecommendation = false) {
  return `<html><body>${missingPriceWithRecommendation ? '<aside data-asin="B000000088"><span class="a-price"><span class="a-offscreen">$9.99</span></span></aside>' : ''}
    <input id="ASIN" value="${asin}"><h1 id="productTitle">Test kettle</h1>
    <span id="glow-ingress-line2">Delivery ${postcode}</span>
    <button id="nav-global-location-popover-link">Delivery location</button>
    <div id="popup" style="display:none"><input id="GLUXZipUpdateInput"><div id="GLUXZipUpdate"><input type="submit" value="Apply"></div></div>
    <div id="buybox"><input id="add-to-cart-button"><div id="corePrice_feature_div">${missingPriceWithRecommendation ? 'See all buying options' : 'Regular Price <span class="a-price priceToPay"><span class="a-offscreen">$100.00</span></span>'}</div>
    <div id="deliveryBlockMessage">${missingPriceWithRecommendation ? 'FREE delivery' : '$5.00 delivery'}</div></div>
    <script>
      document.getElementById('nav-global-location-popover-link').onclick = () => ${showPopup ? "setTimeout(() => document.getElementById('popup').style.display = 'block', 450)" : "{}"};
      document.querySelector('#GLUXZipUpdate input').onclick = () => {
        window.fixturePostcode = document.getElementById('GLUXZipUpdateInput').value;
        document.getElementById('glow-ingress-line2').textContent = 'Delivery ' + document.getElementById('GLUXZipUpdateInput').value;
      };
    </script></body></html>`;
}
type SetupScenario = { pageHtml?: string; navigationStatus?: number; acceptedAddressWithoutLocation?: boolean };
async function harness(showPopup = true, wrongAsin = false, missingPriceWithRecommendation = false, scenario: SetupScenario = {}) {
  let requests = 0;
  let priceReads = 0;
  const contexts = new Set<BrowserContext>();
  const proxy = new Proxy(browser, { get(target, key) {
    if (key === "newContext") return async (options: Parameters<Browser["newContext"]>[0]) => {
      const context = await target.newContext(options); contexts.add(context);
      await context.route("**/*", route => route.abort());
      return new Proxy(context, { get(current, property) {
        if (property === "newPage") return async () => {
          const page = await current.newPage();
          return new Proxy(page, { get(actual, method) {
            if (method === "goto") return async () => {
              const postcode = await actual.evaluate(() => (window as unknown as { fixturePostcode?: string }).fixturePostcode ?? "2000");
              await actual.setContent(scenario.pageHtml ?? fixture(wrongAsin ? "B000000099" : "B0G6CQ427S", postcode, showPopup, missingPriceWithRecommendation));
              return { status: () => scenario.navigationStatus ?? 200, headers: () => ({ "content-type": "text/html" }) };
            };
            if (method === "evaluate") return async (fn: unknown, argument?: { pc?: string }) => {
              if (argument?.pc) {
                requests++;
                return scenario.acceptedAddressWithoutLocation
                  ? { success: true, status: 200, contentType: "application/json", responseText: '{"isValidAddress":1}' }
                  : { success: false, status: 503, contentType: "text/plain", responseText: "" };
              }
              return Reflect.apply(actual.evaluate, actual, [fn, argument]);
            };
            if (method === "waitForSelector") return async (selector: string, options?: Record<string, unknown>) => {
              priceReads++;
              return actual.waitForSelector(selector, options);
            };
            if (method === "waitForFunction") return (fn: unknown, argument?: unknown) =>
              Reflect.apply(actual.waitForFunction, actual, [fn, argument, { timeout: 100 }]);
            const value = Reflect.get(actual, method);
            return typeof value === "function" ? value.bind(actual) : value;
          } });
        };
        if (property === "close") return async () => { contexts.delete(current); await current.close(); };
        const value = Reflect.get(current, property);
        return typeof value === "function" ? value.bind(current) : value;
      } });
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as Browser;
  return { browser: proxy, requests: () => requests, priceReads: () => priceReads, contexts };
}
test("delayed popup recovers HTTP 503 and verifies 2217 on the final page", async () => {
  const f = await harness();
  const diagnostics: Array<{ httpStatus?: number }> = [];
  const result = await scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR", null,
    { onDeliverySetupDiagnostic: detail => diagnostics.push(detail) });
  assert.equal(result.postcodeVerified, true); assert.equal(result.identityOutcome, "MATCH");
  assert.equal(result.price, 105, "shipping must be included exactly once");
  assert.equal(f.requests(), 1); assert.equal(f.contexts.size, 0);
  assert.ok(diagnostics.some(detail => detail.httpStatus === 503));
});
test("wrong ASIN cannot produce an accepted price after popup recovery", async () => {
  const f = await harness(true, true);
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR"),
    (error: unknown) => error instanceof PriceCheckFailure && error.code === "AMAZON_ASIN_REDIRECT");
  assert.equal(f.contexts.size, 0); assert.equal(f.requests(), 1);
});
test("a recommendation ASIN and price cannot replace the verified current product's missing Buy Box", async () => {
  const f = await harness(true, false, true);
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR"),
    (error: unknown) => error instanceof PriceCheckFailure &&
      error.code === "AMAZON_BUYBOX_UNAVAILABLE" && error.postcodeVerified === true);
  assert.equal(f.contexts.size, 0);
  assert.equal(f.requests(), 1);
});
test("cancellation closes the active context and prevents another request", async () => {
  const f = await harness(false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR", null, { signal: controller.signal }));
    assert.equal(f.contexts.size, 0); assert.ok(f.requests() <= 1);
  } finally { clearTimeout(timer); }
});

test("an accepted address response does not prove the final page uses that postcode", async () => {
  const f = await harness(true, false, false, { acceptedAddressWithoutLocation: true });
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR"),
    (error: unknown) => error instanceof AmazonDeliveryFailure &&
      error.details.technicalCode === "AMAZON_DELIVERY_POSTCODE_UNVERIFIED" &&
      error.details.observedDeliveryText?.includes("2000") === true &&
      error.postcodeVerified === false);
  assert.equal(f.requests(), 1);
  assert.equal(f.priceReads(), 0, "a visible price cannot bypass delivery verification");
  assert.equal(f.contexts.size, 0);
});

for (const status of [429, 503]) test("product navigation HTTP " + status + " stops before postcode or price work", async () => {
  const f = await harness(true, false, false, { navigationStatus: status });
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR"),
    (error: unknown) => error instanceof AmazonDeliveryFailure &&
      error.details.httpStatus === status && error.details.stage === "product-navigation" &&
      error.permitsFreshContextRetry === false);
  assert.equal(f.requests(), 0);
  assert.equal(f.priceReads(), 0);
  assert.equal(f.contexts.size, 0);
});

test("HTTP 200 Server Busy stays a technical failure and never becomes an availability decision", async () => {
  const f = await harness(true, false, false, { pageHtml: "<title>Server Busy</title><main>Sorry, please try again later.</main>" });
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR"),
    (error: unknown) => error instanceof AmazonDeliveryFailure &&
      error.code === "TECHNICAL_ERROR" && error.details.httpStatus === 200 &&
      error.details.pageClassification === "TEMPORARY_ERROR" &&
      error.details.stage === "page-classification" && error.postcodeVerified === false);
  assert.equal(f.requests(), 0);
  assert.equal(f.priceReads(), 0);
  assert.equal(f.contexts.size, 0);
});

test("a cancelled operation does not navigate, submit a postcode, or leak its new context", async () => {
  const f = await harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scrapeAmazonPrice("B0G6CQ427S", f.browser, "2217", "REGULAR", null, { signal: controller.signal }));
  assert.equal(f.requests(), 0);
  assert.equal(f.priceReads(), 0);
  assert.equal(f.contexts.size, 0);
});
