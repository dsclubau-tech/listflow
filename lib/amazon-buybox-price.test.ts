import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { extractLocalizedBuyboxPrice } from "@/lib/amazon-buybox-price";

test("extractLocalizedBuyboxPrice prefers buybox price over hidden widget prices", () => {
  const $ = load(`
    <main>
      <section class="video-card">
        <span class="a-price"><span class="a-offscreen">$105.93</span></span>
      </section>
      <section class="recommendation">
        <span class="a-price"><span class="a-offscreen">$98.00</span></span>
      </section>
      <div id="corePrice_feature_div">
        <span class="a-price priceToPay">
          <span class="a-offscreen">$79.99</span>
        </span>
      </div>
    </main>
  `);

  const result = extractLocalizedBuyboxPrice($, "B0D45VM3V8");

  assert.equal(result?.price, 79.99);
  assert.equal(result?.priceSource, "localized_buybox");
  assert.equal(result?.containerSelector, "#corePrice_feature_div");
});

test("extractLocalizedBuyboxPrice returns null when only hidden widget prices exist", () => {
  const $ = load(`
    <main>
      <section class="video-card">
        <span class="a-price"><span class="a-offscreen">$105.93</span></span>
      </section>
      <section class="recommendation">
        <span class="a-price"><span class="a-offscreen">$98.00</span></span>
      </section>
    </main>
  `);

  assert.equal(extractLocalizedBuyboxPrice($, "B0D45VM3V8"), null);
});

test("extractLocalizedBuyboxPrice ignores RRP and coupon prices", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <div class="basisPrice">
        <span class="a-price a-text-price">
          <span class="a-offscreen">$129.99</span>
        </span>
      </div>
      <div class="coupon">
        <span>Apply $20 coupon</span>
      </div>
      <span class="a-price priceToPay">
        <span class="a-offscreen">$79.99</span>
      </span>
    </div>
  `);

  assert.equal(extractLocalizedBuyboxPrice($, "B0D45VM3V8")?.price, 79.99);
});
