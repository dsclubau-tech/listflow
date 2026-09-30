import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { scrapeAmazonPrice } from "../lib/amazon-scraper";
import { createAmazonDeliveryStateSession, resetAmazonDeliveryState, type AmazonDeliveryStateEvent } from "../lib/amazon-delivery-state";
import { PriceCheckFailure } from "../lib/price-check-failures";

let realBrowser: Browser;
before(async () => { realBrowser = await chromium.launch({ headless: true }); });
after(async () => { await realBrowser?.close(); });

function fixture(asin: string, postcode: string, variant: boolean, unavailable: boolean) {
  const prices = `<div id="corePrice_feature_div"><div>Deal price <span class="a-price priceToPay"><span class="a-offscreen">$80.00</span></span></div><div>Regular Price <span class="a-price"><span class="a-offscreen">$100.00</span></span></div></div>`;
  return `<html><head><link rel="canonical" href="https://www.amazon.com.au/dp/${asin}"></head><body>
    <span id="glow-ingress-line2">Delivery ${postcode}</span><span id="productTitle">Fixture product</span>
    <div id="buybox"><input id="ASIN" name="ASIN" value="${asin}"><input id="add-to-cart-button">
    ${variant ? '<div id="corePrice_feature_div"></div>' : prices}
    <div id="deliveryBlockMessage">${variant ? "FREE delivery" : "$5.00 delivery"}</div>${unavailable ? '<div id="availability">Currently unavailable</div>' : ''}</div>
    ${variant ? `<div id="variation_color_name"><span class="selection">Blue</span><button id="fixture-swatch">Red</button></div>` : ''}
  </body></html>`;
}

function harness() {
  const stats = { setups: 0, navigations: 0, seededContexts: 0, closed: 0 };
  const contexts = new Set<BrowserContext>();
  let stale = false;
  let badSetup = false;
  let variant = false;
  let unavailable = false;
  let wrongAsin = false;
  const browser = new Proxy(realBrowser, {
    get(target, key) {
      if (key === "newContext") return async (options?: Parameters<Browser["newContext"]>[0]) => {
        if (options?.storageState) stats.seededContexts++;
        const context = await target.newContext(options);
        contexts.add(context);
        // No external network access: all navigation and postcode responses are fixtures.
        await context.route("**/*", route => route.abort());
        return new Proxy(context, {
          get(current, property) {
            if (property === "close") return async () => {
              stats.closed++;
              contexts.delete(current);
              await current.close();
            };
            if (property === "newPage") return async () => {
              const page = await current.newPage();
              page.setDefaultTimeout(100);
              return new Proxy(page, {
                get(actual, method) {
                  if (method === "goto") return async (url: string) => {
                    stats.navigations++;
                    const cookie = (await current.cookies("https://www.amazon.com.au")).find(c => c.name === "fixture-postcode");
                    const postcode = stale && cookie ? "2000" : cookie?.value ?? "2000";
                    if (cookie) stale = false;
                    const asin = wrongAsin ? "B000000099" : url.match(/\/dp\/([A-Z0-9]{10})/)![1];
                    await actual.setContent(fixture(asin, postcode, variant, unavailable));
                    if (variant) await actual.evaluate(() => {
                      document.getElementById("fixture-swatch")!.addEventListener("click", () => {
                        document.getElementById("corePrice_feature_div")!.innerHTML = '<span class="a-price priceToPay"><span class="a-offscreen">$100.00</span></span>';
                        document.getElementById("glow-ingress-line2")!.textContent = "Delivery 2000";
                      });
                    });
                    return null;
                  };
                  if (method === "evaluate") return async (fn: unknown, argument?: { pc?: string }) => {
                    if (argument?.pc) {
                      stats.setups++;
                      await current.addCookies([{ name: "fixture-postcode", value: badSetup ? "2000" : argument.pc, url: "https://www.amazon.com.au" }]);
                      return { success: true, responseText: '{"isValidAddress":1}' };
                    }
                    return Reflect.apply(actual.evaluate, actual, [fn, argument]);
                  };
                  if (method === "waitForFunction") return (fn: unknown, arg: unknown) =>
                    Reflect.apply(actual.waitForFunction, actual, [fn, arg, { timeout: 60 }]);
                  if (method === "waitForSelector") return (selector: string, options?: Record<string, unknown>) =>
                    Reflect.apply(actual.waitForSelector, actual, [selector, { ...options, timeout: 100 }]);
                  if (method === "waitForTimeout") return async () => {};
                  const value = Reflect.get(actual, method);
                  return typeof value === "function" ? value.bind(actual) : value;
                },
              }) as Page;
            };
            const value = Reflect.get(current, property);
            return typeof value === "function" ? value.bind(current) : value;
          },
        }) as BrowserContext;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Browser;
  return {
    browser, stats, contexts,
    stale() { stale = true; },
    badSetup() { badSetup = true; },
    variant() { variant = true; },
    unavailable() { unavailable = true; },
    wrongAsin() { wrongAsin = true; },
  };
}

test("30 product checks seed once and reuse location with fresh prices and identical shipping/modes", async () => {
  const baseline = harness();
  const experiment = harness();
  const state = createAmazonDeliveryStateSession("2217");
  const events: AmazonDeliveryStateEvent[] = [];
  for (let index = 0; index < 30; index++) {
    const asin = `B${String(index).padStart(9, "0")}`;
    const mode = index % 2 ? "DEAL" : "REGULAR";
    const before = await scrapeAmazonPrice(asin, baseline.browser, "2217", mode);
    const after = await scrapeAmazonPrice(asin, experiment.browser, "2217", mode, null, {
      deliveryState: state, onDeliveryStateEvent: event => events.push(event),
    });
    assert.deepEqual(after, before);
    assert.equal(after.rawPrice, mode === "DEAL" ? 80 : 100);
    assert.equal(after.shippingPrice, 5);
    assert.equal(after.price, mode === "DEAL" ? 85 : 105);
    assert.equal(after.detectedAsin, asin);
    assert.equal(after.postcodeVerified, true);
  }
  assert.equal(baseline.stats.setups, 30);
  assert.equal(baseline.stats.navigations, 60);
  assert.equal(experiment.stats.setups, 1);
  assert.equal(experiment.stats.navigations, 31);
  assert.equal(experiment.stats.seededContexts, 29);
  assert.equal(events.filter(event => event === "reused").length, 29);
  assert.equal(experiment.contexts.size, 0);
  resetAmazonDeliveryState(state);
  assert.equal(state.storageState, null);
});

test("stale reused location recovers cold, disables remaining run, and new run can reuse", async () => {
  const h = harness();
  const state = createAmazonDeliveryStateSession("2217");
  await scrapeAmazonPrice("B000000001", h.browser, "2217", "REGULAR", null, { deliveryState: state });
  h.stale();
  const recovered = await scrapeAmazonPrice("B000000002", h.browser, "2217", "REGULAR", null, { deliveryState: state });
  assert.equal(recovered.postcodeVerified, true);
  assert.equal(state.disabled, true);
  assert.match(state.disabledReason!, /2217/);
  const seededContexts = h.stats.seededContexts;
  await scrapeAmazonPrice("B000000003", h.browser, "2217", "REGULAR", null, { deliveryState: state });
  assert.equal(h.stats.seededContexts, seededContexts);
  assert.equal(h.stats.setups, 3);
  const next = createAmazonDeliveryStateSession("2217");
  await scrapeAmazonPrice("B000000004", h.browser, "2217", "REGULAR", null, { deliveryState: next });
  assert.equal(next.disabled, false);
  assert.notEqual(next.storageState, null);
  assert.equal(h.contexts.size, 0);
});

test("store/run isolation and leading-zero postcode need their own setup", async () => {
  const h = harness();
  for (const postcode of ["2217", "2217", "0800"]) {
    const state = createAmazonDeliveryStateSession(postcode);
    const result = await scrapeAmazonPrice("B000000001", h.browser, postcode, "REGULAR", null, { deliveryState: state });
    assert.equal(result.postcodeVerified, true);
    assert.equal(state.postcode, postcode);
  }
  assert.equal(h.stats.setups, 3);
});

test("wrong postcode remains a technical error and closes the context", async () => {
  const h = harness();
  h.badSetup();
  await assert.rejects(scrapeAmazonPrice("B000000001", h.browser, "2217"),
    error => error instanceof PriceCheckFailure && error.code === "TECHNICAL_ERROR");
  assert.equal(h.contexts.size, 0);
});

test("variant navigation changing postcode rejects the recovered price", async () => {
  const h = harness();
  h.variant();
  await assert.rejects(scrapeAmazonPrice("B000000001", h.browser, "2217", "REGULAR", { colour: "Red" }),
    error => error instanceof PriceCheckFailure && error.code === "TECHNICAL_ERROR" && /final product page/.test(error.message));
  assert.equal(h.contexts.size, 0);
});

test("verified unavailable stock and wrong ASIN preserve their classifications", async () => {
  const h = harness();
  h.unavailable();
  await assert.rejects(scrapeAmazonPrice("B000000001", h.browser, "2217"),
    error => error instanceof PriceCheckFailure && error.code === "AMAZON_OUT_OF_STOCK");
  const mismatch = harness();
  mismatch.wrongAsin();
  await assert.rejects(scrapeAmazonPrice("B000000001", mismatch.browser, "2217"),
    error => error instanceof PriceCheckFailure && error.code === "AMAZON_ASIN_REDIRECT");
  assert.equal(h.contexts.size + mismatch.contexts.size, 0);
});

test("cancellation closes its context and accepts no observation", async () => {
  const h = harness();
  const controller = new AbortController();
  await assert.rejects(scrapeAmazonPrice("B000000001", h.browser, "2217", "REGULAR", null, { signal: controller.signal, onTiming: stage => { if (stage === "navigation") controller.abort(); } }));
  assert.equal(h.contexts.size, 0);
});
test("replacement browser never reuses the previous browser's delivery state", async () => {
  const first = harness();
  const state = createAmazonDeliveryStateSession("2217");
  await scrapeAmazonPrice("B000000001", first.browser, "2217", "REGULAR", null, { deliveryState: state });
  const replacement = harness();
  await scrapeAmazonPrice("B000000002", replacement.browser, "2217", "REGULAR", null, { deliveryState: state });
  assert.equal(replacement.stats.seededContexts, 0);
  assert.equal(replacement.stats.setups, 1);
  assert.equal(state.browser, replacement.browser);
});