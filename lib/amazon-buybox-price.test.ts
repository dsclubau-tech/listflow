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

test("public limited-time deals remain eligible for regular tracking", () => {
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
    assert.equal(choices.regular?.price, Number(example.price));
    assert.equal(choices.regular?.mode, "REGULAR");
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
  assert.equal(choices.regular?.price, 210.98);
});

test("regular tracking follows a public promotion and its end without double-counting shipping", () => {
  for (const [label, price] of [["", 100], ["Limited time deal", 80], ["", 100]] as const) {
    const $ = load(`<div id="corePrice_feature_div">
      <span>${label}</span><span class="a-price priceToPay"><span class="a-offscreen">$${price}.00</span></span>
      <div class="basisPrice">RRP: <span class="a-price a-text-price"><span class="a-offscreen">$120.00</span></span></div>
    </div><div id="deliveryBlockMessage">$4.95 delivery</div>`);
    const selected = extractLocalizedBuyboxPriceForMode($, "B0PUBLIC01", "REGULAR");
    assert.equal(selected?.itemPrice, price);
    assert.equal(selected?.price, price + 4.95);
    assert.equal(selected?.shippingFee, 4.95);
  }
});

test("limited-time label never promotes a Prime-only price, including restrictions elsewhere in the Buy Box", () => {
  for (const restriction of [
    "Exclusive Prime price", "With Prime", "This deal is exclusively for Amazon Prime members.",
    "Prime members only", "Prime price", "Prime Big Deal", "Join Prime", "Subscribe & Save", "Business price",
  ]) {
    const $ = load(`<div id="corePrice_feature_div">Limited time deal
      <span class="a-price priceToPay"><span class="a-offscreen">$80.00</span></span>
    </div><div id="desktop_buybox">${restriction}</div>`);
    assert.equal(extractLocalizedBuyboxPriceForMode($, "B0PUBLIC01", "REGULAR"), null, restriction);
  }
});

test("Prime deal, new regular, and used offers keep their distinct prices", () => {
  const $ = load(`<div id="corePrice_feature_div">Limited time deal
    <span class="a-price priceToPay"><span class="a-offscreen">$162.45</span></span>
  </div><div id="desktop_buybox"><div id="buyBoxAccordion">
    <div data-csa-c-buying-option-type="PRIME_SAVINGS_UPSELL">Deal price
      <span class="a-price"><span class="a-offscreen">$162.45</span></span>
      This deal is exclusively for Amazon Prime members. Join Prime
    </div>
    <div data-csa-c-buying-option-type="NEW">Regular Price
      <span class="a-price"><span class="a-offscreen">$171.00</span></span>
    </div>
    <div data-csa-c-buying-option-type="USED">Used – Very Good
      <span class="a-price"><span class="a-offscreen">$157.32</span></span>
    </div>
  </div></div>`);
  const choices = extractLocalizedBuyboxPriceChoices($, "B0PUBLIC01");
  assert.equal(choices.regular?.price, 171);
  assert.equal(choices.deal?.price, 162.45);
});

test("a separate deal option does not become regular when its regular card has no price", () => {
  const $ = load(`<div id="desktop_buybox"><div id="buyBoxAccordion">
    <div data-csa-c-buying-option-type="DEAL">Limited time deal
      <span class="a-price"><span class="a-offscreen">$80.00</span></span>
    </div><div data-csa-c-buying-option-type="NEW">Regular Price</div>
  </div></div>`);
  assert.equal(extractLocalizedBuyboxPriceForMode($, "B0PUBLIC01", "REGULAR"), null);
});

test("limited-time label does not make reference, coupon, used, or unstructured prices regular", () => {
  for (const markup of [
    '<div class="basisPrice">Was: <span class="a-price a-text-price"><span class="a-offscreen">$100.00</span></span></div>',
    '<div class="coupon">Save <span class="a-price"><span class="a-offscreen">$10.00</span></span></div>',
    '<div data-csa-c-buying-option-type="USED">Used <span class="a-price"><span class="a-offscreen">$60.00</span></span></div>',
    '<div data-csa-c-buying-option-type="RENEWED">Refurbished <span class="a-price"><span class="a-offscreen">$60.00</span></span></div>',
    '<div class="a-box">Used – Very Good <span class="a-price"><span class="a-offscreen">$60.00</span></span></div>',
    '<div class="unknown-price">$80.00</div>',
  ]) {
    const $ = load(`<div id="corePrice_feature_div">Limited time deal ${markup}</div>`);
    assert.equal(extractLocalizedBuyboxPriceForMode($, "B0PUBLIC01", "REGULAR"), null, markup);
  }
});

test("ambiguous conflicting limited-time prices are not promoted to regular", () => {
  const $ = load(`<div id="corePrice_feature_div">Limited time deal
    <span class="a-price priceToPay"><span class="a-offscreen">$80.00</span></span>
  </div><div id="desktop_buybox">Limited time deal
    <span class="a-price priceToPay"><span class="a-offscreen">$90.00</span></span>
  </div>`);
  assert.equal(extractLocalizedBuyboxPriceForMode($, "B0PUBLIC01", "REGULAR"), null);
});

test("crossed-out regular reference price is never selected instead of the public sale price", () => {
  const $ = load(`<div id="corePrice_feature_div">Limited time deal
    <span class="a-price priceToPay"><span class="a-offscreen">$80.00</span></span>
    <div class="basisPrice">Regular Price: <span class="a-price a-text-price"><span class="a-offscreen">$100.00</span></span></div>
  </div>`);
  const choices = extractLocalizedBuyboxPriceChoices($, "B0PUBLIC01");
  assert.equal(choices.regular?.price, 80);
  assert.equal(choices.deal?.price, 80);
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

test("extractLocalizedBuyboxPriceChoices extracts distinct Regular and Prime prices when corePrice shows discounted prime price", () => {
  const $ = load(`
    <main>
      <!-- Center column core price feature div showing Prime price and discount against RRP -->
      <div id="corePrice_feature_div">
        <div class="reinventPriceSavingsPercentageMargin savingsPercentage">-60%</div>
        <span class="a-price priceToPay">
          <span class="a-offscreen">A$119.99</span>
        </span>
        <div class="basisPrice">
          <span>RRP:</span>
          <span class="a-price a-text-price">
            <span class="a-offscreen">A$299.99</span>
          </span>
        </div>
      </div>
      <!-- Right-side Buybox accordion with both Prime savings upsell and Regular price cards -->
      <div id="desktop_buybox">
        <div id="buyBoxAccordion">
          <div id="primeSavingsUpsellAccordionRow" data-csa-c-buying-option-type="PRIME_SAVINGS_UPSELL">
            <div class="header-price">
              <span class="a-price">
                <span class="a-offscreen">A$119.99</span>
              </span>
            </div>
            <span>Prime Savings Exclusive</span>
          </div>
          <div id="newAccordionRow" data-csa-c-buying-option-type="NEW">
            <div class="header-price">
              <span class="a-price">
                <span class="a-offscreen">A$299.99</span>
              </span>
            </div>
            <span>Regular Price</span>
          </div>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0FY6B7WZ5");

  assert.equal(choices.regular?.price, 299.99);
  assert.equal(choices.regular?.mode, "REGULAR");
  assert.equal(choices.regular?.label, "Regular price");

  assert.equal(choices.deal?.price, 119.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Prime member price");
});

test("extractLocalizedBuyboxPriceChoices rejects page-wide prices when Buy Box selectors miss", () => {
  const $ = load(`
    <main id="dp">
      <div id="centerCol">
        <div class="custom-new-redesign-wrapper">
          <span class="random-price-label-2026">$84.50</span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0TESTFALL1");

  assert.equal(choices.regular, null);
  assert.equal(choices.deal, null);
});

test("extractLocalizedBuyboxPriceChoices fallback ignores prices in recommendation/video-card widgets outside buybox", () => {
  const $ = load(`
    <main>
      <section class="sponsored-products">
        <span class="some-price">$19.99</span>
      </section>
      <div id="related-items">
        <div>$49.95</div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0TESTFALL2");

  assert.equal(choices.regular, null);
  assert.equal(choices.deal, null);
});

test("extractLocalizedBuyboxPriceChoices rejects coupon and basis prices without a Buy Box", () => {
  const $ = load(`
    <main id="dp">
      <div id="centerCol">
        <div class="basisPrice">
          <span class="a-offscreen">$120.00</span>
        </div>
        <div class="coupon">
          <span>Save $10.00 with coupon</span>
        </div>
        <div class="novel-unrecognized-container">
          <span class="novel-unrecognized-tag">A$67.80</span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0TESTFALL3");

  assert.equal(choices.regular, null);
  assert.equal(choices.deal, null);
});

test("extractLocalizedBuyboxPriceChoices prefers standard selectors when available and does not trigger fallback", () => {
  const $ = load(`
    <main id="dp">
      <div id="centerCol">
        <div id="corePrice_feature_div">
          <span class="a-price priceToPay">
            <span class="a-offscreen">$49.00</span>
          </span>
        </div>
        <div class="unrelated-text">
          <span>A$99.00</span>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0TESTFALL4");

  assert.ok(choices.regular !== null);
  assert.equal(choices.regular?.price, 49.0);
  assert.notEqual(choices.regular?.selector, "fallback:currency-sweep");
});

test("extractLocalizedBuyboxPriceChoices reads Lightning Deal accordion with data-csa-c-buying-option-type DEAL", () => {
  const $ = load(`
    <main>
      <div id="desktop_buybox">
        <div id="buyBoxAccordion">
          <div id="dealAccordionRow" data-csa-c-buying-option-type="DEAL">
            <div class="header-price">
              <span class="a-price">
                <span class="a-offscreen">A$94.99</span>
              </span>
            </div>
            <span>Lightning Deal</span>
          </div>
          <div id="newAccordionRow" data-csa-c-buying-option-type="NEW">
            <div class="header-price">
              <span class="a-price">
                <span class="a-offscreen">A$99.99</span>
              </span>
            </div>
            <span>Regular Price</span>
          </div>
        </div>
      </div>
    </main>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0GKQDRYLP");

  assert.equal(choices.deal?.price, 94.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Lightning Deal");
  assert.equal(choices.regular?.price, 99.99);
  assert.equal(choices.regular?.mode, "REGULAR");
  assert.equal(choices.regular?.label, "Regular price");
});

test("extractLocalizedBuyboxPriceChoices reads Lightning Deal labelled boxes", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div class="a-box">
        <span>Lightning Deal</span>
        <span class="a-price priceToPay">
          <span class="a-offscreen">$49.95</span>
        </span>
      </div>
      <div class="a-box">
        <span>Regular Price</span>
        <span class="a-price">
          <span class="a-offscreen">$59.99</span>
        </span>
      </div>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0LIGHTNING1");

  assert.equal(choices.deal?.price, 49.95);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Lightning Deal");
  assert.equal(choices.regular?.price, 59.99);
  assert.equal(choices.regular?.mode, "REGULAR");
});

test("extractLocalizedBuyboxPriceChoices reads labelled Lightning Deal text in corePrice", () => {
  const $ = load(`
    <div id="corePrice_feature_div">
      <div>
        <span>Lightning Deal</span>
        <span class="a-price priceToPay">
          <span class="a-offscreen">A$94.99</span>
        </span>
      </div>
      <div>
        <span>Regular Price</span>
        <span class="a-price">
          <span class="a-offscreen">A$99.99</span>
        </span>
      </div>
    </div>
  `);

  const choices = extractLocalizedBuyboxPriceChoices($, "B0LIGHTNING2");

  assert.equal(choices.deal?.price, 94.99);
  assert.equal(choices.deal?.mode, "DEAL");
  assert.equal(choices.deal?.label, "Lightning Deal");
  assert.equal(choices.regular?.price, 99.99);
  assert.equal(choices.regular?.mode, "REGULAR");
});
