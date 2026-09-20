import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAmazonPriceSnapshot } from "./amazon-price-snapshot";

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
