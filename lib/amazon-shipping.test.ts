import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import {
  extractAmazonShippingFeeFromCheerio,
  parseAmazonShippingFeeFromText,
} from "@/lib/amazon-shipping";

test("parseAmazonShippingFeeFromText parses international delivery fee correctly", () => {
  // Scenario from user screenshot
  const text =
    "$69.37 International delivery Tuesday, 15 September. Details Or fastest delivery Tuesday, 8 September. Details";
  assert.equal(parseAmazonShippingFeeFromText(text), 69.37);
});

test("parseAmazonShippingFeeFromText parses AU domestic delivery fees", () => {
  assert.equal(
    parseAmazonShippingFeeFromText("$9.95 delivery Wednesday, 3 September"),
    9.95
  );
  assert.equal(
    parseAmazonShippingFeeFromText("A$12.50 shipping fee"),
    12.5
  );
  assert.equal(
    parseAmazonShippingFeeFromText("AU$15.00 delivery"),
    15
  );
  assert.equal(
    parseAmazonShippingFeeFromText("Delivery: $14.50"),
    14.5
  );
  assert.equal(
    parseAmazonShippingFeeFromText("+ $8.20 delivery"),
    8.2
  );
});

test("parseAmazonShippingFeeFromText handles free delivery", () => {
  assert.equal(
    parseAmazonShippingFeeFromText(
      "FREE delivery Tuesday, 15 September on orders dispatched by Amazon over $39"
    ),
    0
  );
  assert.equal(
    parseAmazonShippingFeeFromText("FREE delivery for Prime members"),
    0
  );
  assert.equal(
    parseAmazonShippingFeeFromText("FREE International delivery"),
    0
  );
});

test("extractAmazonShippingFeeFromCheerio extracts shipping from HTML elements", () => {
  const html = `
    <div id="buybox">
      <div id="corePrice_feature_div">
        <span class="a-price"><span class="a-offscreen">$108.81</span></span>
      </div>
      <div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE">
        <span>$69.37 International delivery Tuesday, 15 September. Details</span>
      </div>
    </div>
  `;
  const $ = load(html);
  assert.equal(extractAmazonShippingFeeFromCheerio($), 69.37);
});
