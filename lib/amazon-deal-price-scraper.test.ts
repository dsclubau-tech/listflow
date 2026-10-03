import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { chromium, type Browser } from "playwright-core";
import { scrapeAmazonPrice } from "./amazon-scraper";
import { PriceCheckFailure } from "./price-check-failures";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const asin = "B0TEST1234";
const price = (amount: number) => `<span class="a-price"><span class="a-offscreen">$${amount.toFixed(2)}</span></span>`;
const regular = `<div id="corePrice_feature_div">${price(749)}</div>`;
const separateOffers = `<div>Deal price ${price(429)}</div><div>Regular Price ${price(749)}</div>`;
function html(offer: string, extra = "") {
  return `<html><head><title>Fixture product</title></head><body>
    <input id="ASIN" value="${asin}"><h1 id="productTitle">Fixture product</h1>
    <div id="glow-ingress-line2">Kogarah 2217</div><div id="availability">Only 10 left in stock.</div>
    <div id="buybox">${offer}<button id="add-to-cart-button">Add to cart</button></div>
    <div id="deliveryBlockMessage">$4.95 delivery</div>${extra}</body></html>`;
}
// Use the real DOM and scraper, but fulfill every browser request locally.
function offlineBrowser(body: string): Browser {
  return {
    newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
      const context = await browser.newContext(options);
      await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body }));
      return {
        newPage: async () => {
          const page = await context.newPage();
          // The scraper's resource filter must not override the fixture network boundary.
          page.route = async () => {};
          return page;
        },
        close: () => context.close(),
        storageState: () => context.storageState(),
      };
    },
  } as unknown as Browser;
}

for (const sharedSnapshot of [false, true]) {
  test(`Deal -> Regular -> Deal uses the actual offer with shared snapshot ${sharedSnapshot}`, async () => {
    for (const [offer, expectedPrice, expectedMode] of [
      [separateOffers, 433.95, "DEAL"], [regular, 753.95, "REGULAR"], [separateOffers, 433.95, "DEAL"],
    ] as const) {
      const result = await scrapeAmazonPrice(asin, offlineBrowser(html(offer)), "2217", "DEAL", null,
        { allowDealPriceFallback: true, sharedSnapshot });
      assert.equal(result.price, expectedPrice);
      assert.equal(result.selectedPriceMode, expectedMode);
      assert.equal(result.priceMode, "DEAL");
      assert.equal(result.rawPrice, expectedMode === "DEAL" ? 429 : 749);
      assert.equal(result.shippingPrice, 4.95);
      assert.equal(result.identityOutcome, "MATCH");
      assert.equal(result.postcodeVerified, true);
    }
  });

  test(`fallback also works after exact variant selection with shared snapshot ${sharedSnapshot}`, async () => {
    const extra = `<div id="variation_color_name"><span class="selection">Blue</span>
      <button onclick="document.getElementById('corePrice_feature_div').innerHTML='${price(749).replaceAll('"', '&quot;')}';
        document.querySelector('#variation_color_name .selection').textContent='Black'">Black</button></div>`;
    const result = await scrapeAmazonPrice(asin, offlineBrowser(html('<div id="corePrice_feature_div"></div>', extra)),
      "2217", "DEAL", { colour: "Black" }, { allowDealPriceFallback: true, sharedSnapshot });
    assert.equal(result.price, 753.95);
    assert.equal(result.selectedPriceMode, "REGULAR");
    assert.equal(result.variantSelectionFailed, undefined);
    assert.equal(result.postcodeVerified, true);
    assert.equal(result.identityOutcome, "MATCH");
  });
}

test("upload-style strict selection rejects Regular fallback while Regular tracking ignores separate deals", async () => {
  const strict = await scrapeAmazonPrice(asin, offlineBrowser(html(regular)), "2217", "DEAL");
  assert.equal(strict.price, null);
  assert.equal(strict.selectedPriceMode, null);
  const tracked = await scrapeAmazonPrice(asin, offlineBrowser(html(separateOffers)), "2217", "REGULAR", null,
    { allowDealPriceFallback: true });
  assert.equal(tracked.price, 753.95);
  assert.equal(tracked.selectedPriceMode, "REGULAR");
});

test("fallback never accepts a redirected ASIN, unavailable buy box, or challenge page", async () => {
  for (const [body, code] of [
    [html(regular).replace(asin, "B0OTHER123"), "AMAZON_ASIN_REDIRECT"],
    [html(regular).replace('<button id="add-to-cart-button">Add to cart</button>', ""), "AMAZON_BUYBOX_UNAVAILABLE"],
    [html(regular).replace("<title>Fixture product</title>", "<title>Robot Check</title>"), "TECHNICAL_ERROR"],
  ]) {
    await assert.rejects(scrapeAmazonPrice(asin, offlineBrowser(body), "2217", "DEAL", null,
      { allowDealPriceFallback: true }), error => error instanceof PriceCheckFailure && error.code === code);
  }
});
