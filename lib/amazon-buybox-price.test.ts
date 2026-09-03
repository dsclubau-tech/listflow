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

test("extractLocalizedBuyboxPriceChoices includes shipping fee in effective price", () => {
  const $ = load(`
    <div id="buybox">
      <div id="corePrice_feature_div">
        <span class="a-price priceToPay">
          <span class="a-offscreen">$108.81</span>
        </span>
      </div>
      <div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE">
        <span>$69.37 International delivery Tuesday, 15 September. Details</span>
      </div>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0CCHSMGWT");

  assert.equal(choices.shippingFee, 69.37);
  assert.equal(choices.regular?.price, 178.18);
  assert.equal(choices.regular?.itemPrice, 108.81);
  assert.equal(choices.regular?.shippingFee, 69.37);
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

test("extractLocalizedBuyboxPriceChoices reads Exclusive Prime price labels", () => {
  const $ = load(`
    <main>
      <div id="corePrice_feature_div">
        <div>
          <span>-15%</span>
          <span class="a-price priceToPay">
            <span class="a-offscreen">$152.99</span>
          </span>
        </div>
        <div>
          <span>RRP: $179.99</span>
        </div>
        <div>
          <span>Exclusive Prime price</span>
        </div>
      </div>
      <div id="desktop_buybox">
        <div>
          <span>Regular Price</span>
          <span class="a-price">
            <span class="a-offscreen">$179.99</span>
          </span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0WOODBURN1");

  assert.equal(choices.deal?.price, 152.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.regular?.price, 179.99);
  assert.equal(choices.regular?.mode, "REGULAR");
});

test("extractLocalizedBuyboxPriceChoices recognizes limited-time deal labels", () => {
  const examples = [
    { label: "Limited time deal", price: "210.98", rrp: "349.00" },
    { label: "LIMITED   TIME   DEAL", price: "169.00", rrp: "329.00" },
    { label: "Limited - time-DEAL", price: "248.99", rrp: "319.00" },
  ];

  for (const [index, example] of examples.entries()) {
    const $ = load(`
      <div id="corePrice_feature_div">
        <div>
          <span>${example.label}</span>
          <span class="a-price priceToPay">
            <span class="a-offscreen">A$${example.price}</span>
          </span>
        </div>
        <div class="basisPrice">
          <span>RRP:</span>
          <span class="a-price a-text-price">
            <span class="a-offscreen">A$${example.rrp}</span>
          </span>
        </div>
      </div>
    `);

    const choices = extractLocalizedBuyboxPriceChoices(
      $,
      `B0LIMITED${index}`,
    );

    assert.equal(choices.deal?.price, Number(example.price));
    assert.equal(choices.deal?.mode, "DEAL");
    assert.equal(choices.regular, null);
    assert.equal(
      extractLocalizedBuyboxPriceForMode($, `B0LIMITED${index}`, "DEAL")
        ?.price,
      Number(example.price),
    );
  }
});

test("extractLocalizedBuyboxPriceChoices reads split limited-time deal markup", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <span>Limited time deal</span>
      <span class="a-price priceToPay">
        <span class="a-price-symbol">$</span>
        <span class="a-price-whole">210</span>
        <span class="a-price-fraction">98</span>
      </span>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0LIMITED99");

  assert.equal(choices.deal?.price, 210.98);
  assert.equal(choices.regular, null);
});

test("extractLocalizedBuyboxPriceForMode stays strict for regular-only prices", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <span>Regular Price</span>
      <span class="a-price priceToPay">
        <span class="a-offscreen">$210.98</span>
      </span>
    </div>
  `);

  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0REGULAR01", "DEAL"),
    null,
  );
  assert.equal(
    extractLocalizedBuyboxPriceForMode($, "B0REGULAR01", "REGULAR")?.price,
    210.98,
  );
});

test("extractLocalizedBuyboxPriceChoices treats a verified Amazon discount as both deal and regular", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <div class="reinventPricePriceToPayMargin">
        <span class="savingsPercentage">-8%</span>
        <span class="a-price priceToPay">
          <span class="a-offscreen">A$109.99</span>
        </span>
      </div>
      <div class="basisPrice">
        <span>RRP:</span>
        <span class="a-price a-text-price">
          <span class="a-offscreen">A$119.99</span>
        </span>
      </div>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0DGXWW1S9");

  assert.equal(choices.deal?.price, 109.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Discounted price");
  assert.equal(choices.regular?.price, 109.99);
  assert.equal(choices.regular?.mode, "REGULAR");
});

test("extractLocalizedBuyboxPriceChoices keeps regular price active for -48% and -6% discounts", () => {
  // BlueAnt X6 Speaker case (-48% $299.00, RRP $579.00)
  const $speaker = load(`
    <div id="corePrice_feature_div">
      <span class="savingsPercentage">-48%</span>
      <span class="a-price priceToPay">
        <span class="a-offscreen">$299.00</span>
      </span>
      <div class="basisPrice">
        <span>RRP:</span>
        <span class="a-price a-text-price">
          <span class="a-offscreen">$579.00</span>
        </span>
      </div>
    </div>
  `);
  const speakerChoices = extractLocalizedBuyboxPriceChoices($speaker, "B0D485B3WS");
  assert.equal(speakerChoices.regular?.price, 299.0);
  assert.equal(speakerChoices.deal?.price, 299.0);

  // Gawfolk Gaming Monitor case (-6% $159.99, RRP $169.99)
  const $monitor = load(`
    <div id="corePrice_feature_div">
      <span class="savingsPercentage">-6%</span>
      <span class="a-price priceToPay">
        <span class="a-offscreen">$159.99</span>
      </span>
      <div class="basisPrice">
        <span>RRP:</span>
        <span class="a-price a-text-price">
          <span class="a-offscreen">$169.99</span>
        </span>
      </div>
    </div>
  `);
  const monitorChoices = extractLocalizedBuyboxPriceChoices($monitor, "B0GY3GZLY7");
  assert.equal(monitorChoices.regular?.price, 159.99);
  assert.equal(monitorChoices.deal?.price, 159.99);
});

test("discount inference requires both savings percentage and a higher reference price", () => {
  const percentageOnly = load(`
    <div id="corePrice_feature_div">
      <span class="savingsPercentage">-8%</span>
      <span class="a-price priceToPay">
        <span class="a-offscreen">A$109.99</span>
      </span>
    </div>
  `);
  const referenceOnly = load(`
    <div id="corePrice_feature_div">
      <span class="a-price priceToPay">
        <span class="a-offscreen">A$109.99</span>
      </span>
      <div class="basisPrice">
        <span class="a-price a-text-price">
          <span class="a-offscreen">A$119.99</span>
        </span>
      </div>
    </div>
  `);
  const nonDiscount = load(`
    <div id="corePrice_feature_div">
      <span class="savingsPercentage">-8%</span>
      <span class="a-price priceToPay">
        <span class="a-offscreen">A$109.99</span>
      </span>
      <div class="basisPrice">
        <span class="a-price a-text-price">
          <span class="a-offscreen">A$99.99</span>
        </span>
      </div>
    </div>
  `);

  for (const $ of [percentageOnly, referenceOnly, nonDiscount]) {
    const choices = extractLocalizedBuyboxPriceChoices($, "B0STRICT001");
    assert.equal(choices.deal, null);
    assert.equal(choices.regular?.price, 109.99);
  }
});

test("extractLocalizedBuyboxPriceChoices returns Prime Member and Regular price cards", () => {
  const $ = load(`
    <main>
      <section class="recommendation">
        <span class="a-price"><span class="a-offscreen">$129.00</span></span>
      </section>
      <div id="desktop_buybox">
        <div class="a-box">
          <span>Prime Member Price</span>
          <span class="a-price priceToPay">
            <span class="a-price-symbol">$</span>
            <span class="a-price-whole">159</span>
            <span class="a-price-fraction">98</span>
          </span>
          <span>Join Prime</span>
        </div>
        <div class="a-box">
          <span>Regular Price</span>
          <span class="a-price">
            <span class="a-price-symbol">$</span>
            <span class="a-price-whole">249</span>
            <span class="a-price-fraction">98</span>
          </span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0FN3LF2B8");

  assert.equal(choices.deal?.price, 159.98);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Prime member price");
  assert.equal(choices.regular?.price, 249.98);
  assert.equal(choices.regular?.mode, "REGULAR");
  assert.equal(choices.regular?.label, "Regular price");
  assert.notEqual(choices.deal?.price, 129);
  assert.notEqual(choices.regular?.price, 129);
});
