import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { extractLocalizedBuyboxPriceChoices, selectAmazonBuyboxPriceForTracking } from "./amazon-buybox-price";
import { extractAmazonPriceSnapshot } from "./amazon-price-snapshot";
import { extractAmazonShippingEvidence, extractAmazonShippingEvidenceFromHtml } from "./amazon-shipping-extraction";
import { evaluateAmazonShipping } from "./amazon-shipping-evidence";
import { accordionShippingOffers, deliveryBlock, normalShippingOffer, newAndUsedShippingOffers } from "../tests/fixtures/amazon-shipping-offers";

const now = new Date("2026-10-05T01:00:00Z");
function extract(html: string, mode: "REGULAR" | "DEAL" = "REGULAR", shared = false) {
  const choices = shared ? extractAmazonPriceSnapshot(html, "B0FPQNVHG8").priceChoices : extractLocalizedBuyboxPriceChoices(load(html), "B0FPQNVHG8");
  const offer = selectAmazonBuyboxPriceForTracking(choices, mode);
  assert.ok(offer);
  return { offer, evidence: extractAmazonShippingEvidenceFromHtml(html, offer, "2217", now) };
}
test("butter-maker primary arrival passes despite nested wrappers and faster delivery", () => {
  const { offer, evidence } = extract(normalShippingOffer());
  assert.equal(offer.price, 137.73);
  assert.equal(evidence.arrivalLatest, "2026-10-10");
  assert.equal(evaluateAmazonShipping(evidence, 25, now).outcome, "WITHIN_LIMIT");
});
test("large, medium and small primary slots preserve the ordinary arrival", () => {
  for (const size of ["LARGE", "MEDIUM", "SMALL"]) assert.equal(extract(normalShippingOffer(undefined, undefined, size)).evidence.arrivalLatest, "2026-10-10");
});
test("Regular, Deal and Regular fallback use their own card in both extraction paths", () => {
  for (const shared of [false, true]) {
    assert.equal(extract(accordionShippingOffers(), "REGULAR", shared).evidence.arrivalLatest, "2026-10-10");
    assert.equal(extract(accordionShippingOffers(), "DEAL", shared).evidence.arrivalLatest, "2026-10-06");
    const fallback = extract(accordionShippingOffers(false), "DEAL", shared);
    assert.equal(fallback.offer.mode, "REGULAR");
    assert.equal(fallback.evidence.mode, "REGULAR");
    assert.equal(fallback.evidence.arrivalLatest, "2026-10-10");
  }
});
test("an over-limit primary arrival cannot be replaced by a faster paid option", () => {
  const { evidence } = extract(normalShippingOffer("FREE delivery 31 October", "Or fastest delivery tomorrow for $20"));
  assert.equal(evidence.arrivalLatest, "2026-10-31");
  assert.equal(evaluateAmazonShipping(evidence, 25, now).outcome, "OVER_LIMIT");
});
test("fallback containers discard secondary subtrees and nested copies", () => {
  const html = normalShippingOffer().replace(/id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE"/, 'id="ordinary-message"');
  assert.equal(extract(html).evidence.arrivalLatest, "2026-10-10");
  const nested = '<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span><div id="deliveryBlockMessage"><div id="delivery-message">FREE delivery 10 October</div></div></div>';
  assert.equal(extract(nested).evidence.arrivalLatest, "2026-10-10");
});
test("faster-only delivery stays unknown, including a fallback text message", () => {
  for (const message of [
    '<div id="mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE" data-csa-c-delivery-time="fast">Or fastest delivery 8 October</div>',
    '<div id="deliveryBlockMessage">Fastest delivery 8 October</div>',
  ]) {
    const html = `<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span>${message}</div>`;
    assert.equal(extract(html).evidence.outcome, "UNKNOWN");
  }
});
test("conflicting explicit primary promises remain unknown", () => {
  const html = normalShippingOffer().replace('<div id="availability">', `${deliveryBlock("FREE delivery 31 October", "Or fastest delivery 8 October")}<div id="availability">`);
  assert.equal(extract(html).evidence.outcome, "UNKNOWN");
});
test("a range uses its latest endpoint and duplicated ordinary text is not a conflict", () => {
  const html = normalShippingOffer("FREE delivery 7 - 10 October");
  assert.equal(extract(html).evidence.arrivalLatest, "2026-10-10");
  const duplicate = html.replace('<div id="availability">', `${deliveryBlock("FREE delivery 7 - 10 October")}<div id="availability">`);
  assert.equal(extract(duplicate).evidence.arrivalLatest, "2026-10-10");
});
test("hidden, used and recommendation promises cannot supply arrival", () => {
  for (const wrapper of ['id="recommendations"', 'id="usedAccordionRow"', 'hidden', 'aria-hidden="true"']) {
    const html = `<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span><div ${wrapper}>${deliveryBlock()}</div></div>`;
    assert.equal(extract(html).evidence.outcome, "UNKNOWN");
  }
});
test("a unique external product block supplies a single-offer promise", () => {
  const html = '<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span></div>' + deliveryBlock();
  assert.equal(extract(html).evidence.arrivalLatest, "2026-10-10");
});


test("a secondary-only selected offer cannot borrow an external ordinary promise", () => {
  const html = '<div id="buybox"><span class="a-price"><span class="a-offscreen">$20</span></span><div id="deliveryBlockMessage">Or fastest delivery 8 October</div></div>' + deliveryBlock();
  assert.equal(extract(html).evidence.outcome, "UNKNOWN");
});
test("shipping extraction leaves the original DOM and shipping fee untouched", () => {
  const html = normalShippingOffer('$4.95 delivery 10 October','Or fastest delivery 8 October');
  const dom = load(html), choices = extractLocalizedBuyboxPriceChoices(dom, "B0FPQNVHG8");
  const offer = selectAmazonBuyboxPriceForTracking(choices, "REGULAR"); assert.ok(offer);
  const before = dom.html();
  extractAmazonShippingEvidence(dom, offer, "2217", now);
  assert.equal(dom.html(), before);
  assert.equal(offer.price, 142.68); assert.equal(offer.itemPrice, 137.73); assert.equal(offer.shippingFee, 4.95);
});

test("Cuisinart New/Used cards and nested NEW nodes identify the ordinary new-offer arrival", () => {
  for (const used of [true, false]) for (const shared of [true, false]) {
    const html = newAndUsedShippingOffers(used);
    const choices = shared ? extractAmazonPriceSnapshot(html, "B0FPKSQ4WW").priceChoices : extractLocalizedBuyboxPriceChoices(load(html), "B0FPKSQ4WW");
    const offer = selectAmazonBuyboxPriceForTracking(choices, "REGULAR"); assert.ok(offer);
    const at = new Date("2026-10-06T10:00:00Z");
    const evidence = extractAmazonShippingEvidenceFromHtml(html, offer, "2217", at);
    assert.equal(offer.price, 209);
    assert.equal(evidence.arrivalLatest, "2026-10-11");
    assert.equal(evaluateAmazonShipping(evidence, 25, at).arrivalDays, 5);
  }
});

test("genuinely distinct new offers stay unassociated even when their prices match", () => {
  const html = newAndUsedShippingOffers(false);
  const $ = load(html);
  const card = $("#newAccordionRow_0").clone().attr("id", "newAccordionRow_1");
  $("#buyBoxAccordion").append(card);
  const choices = extractLocalizedBuyboxPriceChoices($, "B0FPKSQ4WW");
  const selected = selectAmazonBuyboxPriceForTracking(choices, "REGULAR");
  assert.ok(selected);
  assert.equal(extractAmazonShippingEvidence($, selected, "2217", now).outcome, "UNKNOWN");
});
test("hidden and non-new offers cannot make an eligible new card ambiguous", () => {
  const html = newAndUsedShippingOffers(false);
  for (const condition of ["USED", "RENEWED", "REFURBISHED", "HIDDEN", "UNRELATED"]) {
    const $ = load(html), card = $("#newAccordionRow_0").clone().attr("id", condition + "AccordionRow");
    card.find("[data-csa-c-buying-option-type]").attr("data-csa-c-buying-option-type", condition === "HIDDEN" || condition === "UNRELATED" ? "NEW" : condition);
    if (condition === "HIDDEN") card.attr("hidden", "");
    if (condition === "UNRELATED") card.attr("id", "recommendations");
    $("#buyBoxAccordion").append(card);
    const selected = selectAmazonBuyboxPriceForTracking(extractLocalizedBuyboxPriceChoices($, "B0FPKSQ4WW"), "REGULAR");
    assert.ok(selected);
    assert.equal(extractAmazonShippingEvidence($, selected, "2217", now).outcome, "VERIFIED", condition);
  }
});
test("final offer re-resolution rejects a changed root, price or mode", () => {
  const html = newAndUsedShippingOffers(false);
  const selected = selectAmazonBuyboxPriceForTracking(extractLocalizedBuyboxPriceChoices(load(html), "B0FPKSQ4WW"), "REGULAR");
  assert.ok(selected);
  for (const changed of [
    html.replace('id="newAccordionRow_0"', 'id="newAccordionRow_1"'),
    html.replaceAll("$209.00", "$210.00"),
    html.replaceAll('buying-option-type="NEW"', 'buying-option-type="DEAL"').replace('id="newAccordionRow_0"', 'id="dealAccordionRow"'),
  ]) assert.equal(extractAmazonShippingEvidenceFromHtml(changed, selected, "2217", now).outcome, "UNKNOWN");
});

test("a root-resolved Regular card preserves a separately labelled Deal option", () => {
  const $ = load(newAndUsedShippingOffers(false));
  $("#buyBoxAccordion").append('<div class="a-box">Deal price <span class="a-price"><span class="a-offscreen">$180.00</span></span></div>');
  const choices = extractLocalizedBuyboxPriceChoices($, "B0FPKSQ4WW");
  assert.equal(choices.regular?.itemPrice,209);
  assert.equal(choices.deal?.itemPrice,180);
});

test("New/Used offer roots and shipping totals are equivalent in standard and shared extraction", () => {
  const html=newAndUsedShippingOffers().replaceAll("FREE delivery","$4.95 delivery");
  const direct=extractLocalizedBuyboxPriceChoices(load(html),"B0FPKSQ4WW");
  const shared=extractAmazonPriceSnapshot(html,"B0FPKSQ4WW").priceChoices;
  assert.deepEqual(direct.regular?.offerRoot,shared.regular?.offerRoot);
  assert.equal(direct.regular?.itemPrice,209);assert.equal(direct.regular?.price,213.95);
  assert.equal(shared.regular?.price,213.95);assert.equal(shared.regular?.shippingFee,4.95);
});

test("a root-resolved Regular card preserves a core-price Deal option", () => {
  const html=newAndUsedShippingOffers(false).replace('<div id="corePrice_feature_div"><span', '<div id="corePrice_feature_div">Deal price <span').replace('<span class="a-offscreen">$209.00</span></span></div>','<span class="a-offscreen">$180.00</span></span></div>');
  const choices=extractLocalizedBuyboxPriceChoices(load(html),"B0FPKSQ4WW");
  assert.equal(choices.regular?.itemPrice,209);assert.equal(choices.deal?.itemPrice,180);
  assert.ok(choices.regular?.offerRoot);
});
