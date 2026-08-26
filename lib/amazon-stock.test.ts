import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { extractAmazonNewOfferStockLeft } from "@/lib/amazon-stock";

test("ignores limited Used - Very Good stock when the New offer is in stock", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div id="newAccordionRow" class="a-accordion-row">
        <strong>Buy New</strong>
        <span>$159.90</span>
        <div>In stock</div>
      </div>
      <div id="usedAccordionRow" class="a-accordion-row">
        <strong>Used - Very Good</strong>
        <span>$138.28</span>
        <div id="availability">Only 1 left in stock.</div>
      </div>
    </div>
  `);

  assert.equal(extractAmazonNewOfferStockLeft($), null);
});

test("returns limited stock from the New offer instead of the Used offer", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div id="newAccordionRow" class="a-accordion-row">
        <strong>Buy New</strong>
        <div>Only 3 left in stock - order soon.</div>
      </div>
      <div id="usedAccordionRow" class="a-accordion-row">
        <strong>Used - Very Good</strong>
        <div>Only 1 left in stock.</div>
      </div>
    </div>
  `);

  assert.equal(extractAmazonNewOfferStockLeft($), 3);
});

test("supports the standard single New-offer availability layout", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div id="availability">Only 2 left in stock.</div>
    </div>
  `);

  assert.equal(extractAmazonNewOfferStockLeft($), 2);
});

test("does not use stock from a Used-only condition row", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div id="usedAccordionRow" class="a-accordion-row">
        <strong>Used - Very Good</strong>
        <div id="availability">Only 1 left in stock.</div>
      </div>
    </div>
  `);

  assert.equal(extractAmazonNewOfferStockLeft($), null);
});

test("does not mistake a Renewed offer for a New offer", () => {
  const $ = load(`
    <div id="desktop_buybox">
      <div class="a-accordion-row" data-csa-c-content-id="renewed-offer">
        <strong>Amazon Renewed</strong>
        <div id="availability">Only 1 left in stock.</div>
      </div>
    </div>
  `);

  assert.equal(extractAmazonNewOfferStockLeft($), null);
});
