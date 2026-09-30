import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAmazonPriceSnapshot } from "./amazon-price-snapshot";
import { selectAmazonBuyboxPriceForMode } from "./amazon-buybox-price";

test("one ready HTML snapshot supplies stock, item price, and shipping", () => {
  const result = extractAmazonPriceSnapshot(
    `
      <div id="corePrice_feature_div">
        <span class="a-price"><span class="a-offscreen">$20.00</span></span>
      </div>
      <div id="availability">Only 2 left in stock.</div>
      <div id="deliveryBlockMessage">$4.95 delivery</div>
    `,
    "B0SNAPSHOT1",
  );

  assert.equal(result.stockLeft, 2);
  assert.equal(result.priceChoices.regular?.itemPrice, 20);
  assert.equal(result.priceChoices.regular?.shippingFee, 4.95);
  assert.equal(result.priceChoices.regular?.price, 24.95);
});

test("snapshot preserves unknown stock and missing delivery data", () => {
  const result = extractAmazonPriceSnapshot(
    `<div id="corePrice_feature_div">
      <span class="a-price"><span class="a-offscreen">$31.50</span></span>
    </div>`,
    "B0SNAPSHOT2",
  );

  assert.equal(result.stockLeft, null);
  assert.equal(result.priceChoices.regular?.price, 31.5);
  assert.equal(result.priceChoices.regular?.shippingFee, null);
});

test("rendered snapshot selection accepts public deals but never falls back to Prime-only prices", () => {
  const publicHtml = `<div id="corePrice_feature_div">Limited time deal
    <span class="a-price priceToPay"><span class="a-offscreen">$80.00</span></span>
  </div>`;
  const publicSnapshot = extractAmazonPriceSnapshot(publicHtml, "B0SNAPSHOT1");
  assert.equal(selectAmazonBuyboxPriceForMode(publicSnapshot.priceChoices, "REGULAR")?.price, 80);
  const primeSnapshot = extractAmazonPriceSnapshot(
    publicHtml + '<div id="desktop_buybox">This deal is exclusively for Amazon Prime members.</div>',
    "B0SNAPSHOT1",
  );
  assert.equal(selectAmazonBuyboxPriceForMode(primeSnapshot.priceChoices, "REGULAR"), null);
  assert.equal(selectAmazonBuyboxPriceForMode(primeSnapshot.priceChoices, "DEAL")?.price, 80);
});
