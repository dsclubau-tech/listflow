import { load, type CheerioAPI } from "cheerio";
import type { AmazonBuyboxPriceResult } from "./amazon-buybox-price";
import { parseAmazonShippingEvidence } from "./amazon-shipping-evidence";

const primary = '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, #deliveryBlockMessage, #delivery-message, [data-csa-c-delivery-time]';
const cards = '[data-csa-c-buying-option-type], [id*="AccordionRow"], [id*="dealAccordion"]';
const hidden = '[hidden], [aria-hidden="true"], .aok-hidden, .a-hidden, [style*="display: none"], [style*="display:none"]';

/** Only the accepted offer's primary delivery promise can establish arrival. */
export function extractAmazonShippingEvidence($: CheerioAPI, selected: AmazonBuyboxPriceResult, postcode: string, observedAt: Date) {
  const roots = $('#buybox, #desktop_buybox, #buybox_feature_div, #buyBoxAccordion');
  let scope = roots;
  let associated = roots.length > 0;
  if (/accordion/i.test(selected.selector)) {
    const selector = selected.mode === 'DEAL'
      ? '[id*="dealAccordion" i], [id*="primeSavingsUpsell" i], [data-csa-c-buying-option-type="DEAL"], [data-csa-c-buying-option-type="PRIME_SAVINGS_UPSELL"]'
      : '[id*="newAccordionRow" i], [id*="regularPrice" i], [data-csa-c-buying-option-type="NEW"]';
    scope = roots.find(selector).filter((_, element) => $(element).find('.a-price').length > 0).first();
    associated = scope.length === 1;
  } else if (roots.find(cards).filter((_, element) => $(element).find('.a-price').length > 0).length > 1) {
    // Label-based offers without a specific card do not establish which delivery promise applies.
    associated = false;
  }
  if (/^label:/.test(selected.selector) && /regular price/i.test(roots.text()) && /deal price|prime member price/i.test(roots.text())) associated = false;
  const allowed = (element: Parameters<CheerioAPI>[0]) => {
    const node = $(element);
    return !node.closest(hidden).length && !node.closest('#aod-container, #usedAccordionRow, [data-csa-c-buying-option-type="USED"], #recommendations').length;
  };
  let messages = scope.find(primary).filter((_, element) => allowed(element));
  if (!/accordion/i.test(selected.selector) && associated && messages.length === 0) {
    // Amazon sometimes mounts the main promise outside the Buy Box, using these unique product ids.
    messages = $('#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, #deliveryBlockMessage, #delivery-message')
      .filter((_, element) => allowed(element) && !$(element).closest(cards).length);
  }
  const texts = [...new Set(messages.toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const arrivalText = texts.length === 1 ? texts[0].split(/\b(?:Or fastest|fastest delivery|order within)\b/i)[0].trim() : null;
  const dispatchNodes = scope.find('#availability, #availabilityInsideBuyBox_feature_div, [data-csa-c-availability]');
  const dispatchTexts = [...new Set(dispatchNodes.toArray().filter(allowed).map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(text => /dispatch|ships?\s+(?:within|in)/i.test(text)))];
  // The top-level availability block is also a product-scoped promise for a single offer.
  if (!/accordion/i.test(selected.selector) && !dispatchTexts.length && associated) {
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
