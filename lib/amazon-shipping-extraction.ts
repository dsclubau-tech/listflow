import { resolveAmazonOfferRoots, amazonOfferItemPrice, AMAZON_HIDDEN_OFFER, AMAZON_NON_NEW_OFFER, AMAZON_OFFER_CARDS } from "./amazon-offer-roots";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { AmazonBuyboxPriceResult } from "./amazon-buybox-price";
import { parseAmazonShippingEvidence } from "./amazon-shipping-evidence";

const primary = '[id^="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_"]';
const containers = '#deliveryBlockMessage, #delivery-message';
const secondary = '[id^="mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_"]';
const unrelated = AMAZON_NON_NEW_OFFER;
const cards = AMAZON_OFFER_CARDS;
const hidden = AMAZON_HIDDEN_OFFER;

/** Only the accepted offer's primary delivery promise can establish arrival. */
export function extractAmazonShippingEvidence($: CheerioAPI, selected: AmazonBuyboxPriceResult, postcode: string, observedAt: Date) {
  const roots = $('#buybox, #desktop_buybox, #buybox_feature_div, #buyBoxAccordion');
  let scope = roots;
  let associated = roots.length > 0;
  const regularRoots = resolveAmazonOfferRoots($, "REGULAR"), dealRoots = resolveAmazonOfferRoots($, "DEAL");
  const eligibleRoots = selected.mode === "REGULAR" ? regularRoots : dealRoots;
  const hasCardContext = Boolean(selected.offerRoot || /accordion/i.test(selected.selector) || roots.find(cards).length);
  if (hasCardContext) {
    scope = eligibleRoots;
    associated = eligibleRoots.length === 1 &&
      (!selected.offerRoot || (selected.offerRoot.mode === selected.mode && (scope.attr("id") ?? null) === selected.offerRoot.id)) &&
      amazonOfferItemPrice($, scope) === (selected.itemPrice ?? selected.price);
  }
  if (/^label:/.test(selected.selector) && /regular price/i.test(roots.text()) && /deal price|prime member price/i.test(roots.text())) associated = false;
  const allowed = (element: Parameters<CheerioAPI>[0]) => {
    const node = $(element);
    return !node.closest(hidden).length && !node.closest(AMAZON_NON_NEW_OFFER).length;
  };
  const ordinaryTexts = (nodes: Cheerio<AnyNode>) => [...new Set(nodes.toArray()
    .filter(element => allowed(element) && !$(element).closest(secondary).length)
    .map(element => {
      // Work on a clone so price, fee and stock extraction see the original DOM.
      const node = $(element).clone();
      node.find(`${secondary}, ${hidden}, ${unrelated}`).remove();
      return node.text().replace(/\s+/g, ' ').trim()
        .split(/\b(?:Or fastest|fastest delivery|order within)\b/i)[0].trim();
    }).filter(Boolean))];
  const deliveryTexts = (candidate: Cheerio<AnyNode>) => {
    const explicit = candidate.find(primary).filter((_, element) => allowed(element));
    if (explicit.length) return ordinaryTexts(explicit);
    const blocks = candidate.find(containers).filter((_, element) => allowed(element));
    if (blocks.length) return ordinaryTexts(blocks);
    return ordinaryTexts(candidate.find('[data-csa-c-delivery-time]'));
  };
  let texts = deliveryTexts(scope);
  if (!hasCardContext && associated && texts.length === 0 &&
    !scope.find(primary + ', ' + containers + ', [data-csa-c-delivery-time]').filter((_, element) => allowed(element)).length) {
    // Only these product-scoped blocks can supply a promise outside a single Buy Box.
    const external = $(`${primary}, ${containers}`).filter((_, element) =>
      allowed(element) && !$(element).closest(`${cards}, ${secondary}`).length);
    const explicit = external.filter(primary);
    texts = ordinaryTexts(explicit.length ? explicit : external);
  }
  const arrivalText = texts.length === 1 ? texts[0] : null;
  const dispatchNodes = scope.find('#availability, #availabilityInsideBuyBox_feature_div, [data-csa-c-availability]');
  const dispatchTexts = [...new Set(dispatchNodes.toArray().filter(allowed).map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(text => /dispatch|ships?\s+(?:within|in)/i.test(text)))];
  // The top-level availability block is also a product-scoped promise for a single offer.
  if (!hasCardContext && !dispatchTexts.length && associated) {
    $('#availability').filter((_, element) => allowed(element) && !$(element).closest(cards).length).each((_, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (/dispatch|ships?\s+(?:within|in)/i.test(text)) dispatchTexts.push(text);
    });
  }
  return parseAmazonShippingEvidence({ asin: selected.asin ?? '', mode: selected.mode, postcode, observedAt,
    source: /accordion/i.test(selected.selector) ? `${selected.selector}:primary-delivery` : 'selected-buybox:primary-delivery',
    arrivalText, dispatchText: dispatchTexts.length === 1 ? dispatchTexts[0] : null,
    associated: associated && texts.length <= 1 && dispatchTexts.length <= 1 });
}

export function extractAmazonShippingEvidenceFromHtml(html: string, selected: AmazonBuyboxPriceResult, postcode: string, observedAt: Date) {
  return extractAmazonShippingEvidence(load(html), selected, postcode, observedAt);
}
