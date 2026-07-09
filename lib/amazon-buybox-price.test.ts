import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import {
  extractLocalizedBuyboxPrice,
  extractLocalizedBuyboxPriceChoices,
  extractLocalizedBuyboxPriceForMode,
} from "@/lib/amazon-buybox-price";

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

test("extractLocalizedBuyboxPrice reads split whole and fraction price markup", () => {
  const $ = load(`
    <div id="apex_desktop">
      <span class="a-price priceToPay">
        <span class="a-price-symbol">$</span>
        <span class="a-price-whole">169</span>
        <span class="a-price-fraction">95</span>
      </span>
    </div>
  `);

  assert.equal(extractLocalizedBuyboxPrice($, "B0SPLIT123")?.price, 169.95);
});

test("extractLocalizedBuyboxPriceChoices returns deal and regular buybox prices", () => {
  const $ = load(`
    <main>
      <section class="recommendation">
        <span class="a-price"><span class="a-offscreen">$105.93</span></span>
      </section>
      <div id="corePrice_feature_div">
        <div>
          <span>Deal price</span>
          <span class="a-price priceToPay">
            <span class="a-offscreen">$63.99</span>
          </span>
        </div>
        <div>
          <span>Regular Price</span>
          <span class="a-price">
            <span class="a-offscreen">$79.99</span>
          </span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0DEAL1234");

  assert.equal(choices.deal?.price, 63.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.regular?.price, 79.99);
  assert.equal(choices.regular?.mode, "REGULAR");
  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0DEAL1234", "DEAL")?.price,
    63.99
  );
  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0DEAL1234", "REGULAR")?.price,
    79.99
  );
});

test("extractLocalizedBuyboxPriceChoices reads split labelled deal and regular prices", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <div>
        <span>Deal price</span>
        <span class="a-price priceToPay">
          <span class="a-price-symbol">$</span>
          <span class="a-price-whole">166</span>
          <span class="a-price-fraction">24</span>
        </span>
      </div>
      <div>
        <span>Regular Price</span>
        <span class="a-price">
          <span class="a-price-symbol">$</span>
          <span class="a-price-whole">219</span>
          <span class="a-price-fraction">99</span>
        </span>
      </div>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0BVDJD5S4");

  assert.equal(choices.deal?.price, 166.24);
  assert.equal(choices.regular?.price, 219.99);
});

test("extractLocalizedBuyboxPriceChoices reads compact split labelled prices without inflating cents", () => {
  const $ = load(`
    <div id="corePrice_feature_div"><div><span>Deal price</span><span class="a-price priceToPay"><span class="a-price-symbol">$</span><span class="a-price-whole">166</span><span class="a-price-fraction">24</span></span></div><div><span>Regular Price</span><span class="a-price"><span class="a-price-symbol">$</span><span class="a-price-whole">219</span><span class="a-price-fraction">99</span></span></div></div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0BVDJD5S4");

  assert.equal(choices.deal?.price, 166.24);
  assert.equal(choices.regular?.price, 219.99);
});

test("extractLocalizedBuyboxPriceChoices does not treat a labelled deal as regular", () => {
  const $ = load(`
    <main>
      <div id="corePrice_feature_div">
        <div>
          <span>Deal price</span>
          <span class="a-price priceToPay">
            <span class="a-offscreen">$166.24</span>
          </span>
        </div>
      </div>
      <div id="desktop_buybox">
        <div>
          <span>Regular Price</span>
          <span class="a-price">
            <span class="a-offscreen">$219.99</span>
          </span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0BVDJD5S4");

  assert.equal(choices.deal?.price, 166.24);
  assert.equal(choices.regular?.price, 219.99);
});

test("extractLocalizedBuyboxPriceForMode does not fall back to another mode", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <div>
        <span>Deal price</span>
        <span class="a-price priceToPay">
          <span class="a-offscreen">$63.99</span>
        </span>
      </div>
    </div>
  `);

  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0DEAL1234", "REGULAR"),
    null
  );
  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0DEAL1234", "DEAL")?.price,
    63.99
  );
});
