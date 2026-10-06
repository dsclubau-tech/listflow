import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { AmazonPriceTrackingMode } from "./amazon-price-tracking";

export const AMAZON_OFFER_CARDS = '[data-csa-c-buying-option-type], [id*="AccordionRow" i], [id*="dealAccordion" i], [id*="regularPrice" i], [id*="primeSavingsUpsell" i]';
export const AMAZON_HIDDEN_OFFER = '[hidden], [aria-hidden="true"], .aok-hidden, .a-hidden, [style*="display: none"], [style*="display:none"]';
export const AMAZON_NON_NEW_OFFER = '[id*="usedAccordion" i], [data-csa-c-buying-option-type="USED" i], [data-csa-c-buying-option-type="RENEWED" i], [data-csa-c-buying-option-type="REFURBISHED" i], #aod-container, #recommendations, [id*="recommendation" i]';
export type AmazonOfferRootReference = { mode: AmazonPriceTrackingMode; id: string | null };

function offerMode($: CheerioAPI, element: AnyNode): AmazonPriceTrackingMode | null {
  const node = $(element), type = (node.attr("data-csa-c-buying-option-type") ?? "").toUpperCase(), id = node.attr("id") ?? "";
  if (/used|renewed|refurbished/i.test(id) || ["USED", "RENEWED", "REFURBISHED"].includes(type)) return null;
  if (["DEAL", "PRIME_SAVINGS_UPSELL"].includes(type) || /dealAccordion|primeSavingsUpsell/i.test(id)) return "DEAL";
  if (type === "NEW" || /newAccordionRow|regularPrice/i.test(id)) return "REGULAR";
  return null;
}

/** Distinct eligible cards, not nested price/telemetry representations of one card. */
export function resolveAmazonOfferRoots($: CheerioAPI, mode: AmazonPriceTrackingMode): Cheerio<Element> {
  const roots = $("#buybox, #desktop_buybox, #buybox_feature_div, #buyBoxAccordion");
  const candidates = roots.find(AMAZON_OFFER_CARDS).filter((_, node) =>
    offerMode($, node) === mode && !$(node).closest(AMAZON_HIDDEN_OFFER + ", " + AMAZON_NON_NEW_OFFER).length &&
    $(node).find(".a-price").length > 0);
  const set = new Set(candidates.toArray());
  return candidates.filter((_, node) => !$(node).parents().toArray().some(parent => set.has(parent)));
}

/** Require one current item amount; reference prices and other buying options cannot contribute. */
export function amazonOfferItemPrice($: CheerioAPI, root: Cheerio<AnyNode>): number | null {
  const values = new Set<number>();
  root.find(".a-price").filter((_, node) => !$(node).closest(
    AMAZON_HIDDEN_OFFER + ", " + AMAZON_NON_NEW_OFFER + ", .a-text-price, .basisPrice, [class*='coupon'], [id*='coupon']",
  ).length).each((_, node) => {
    const element = $(node);
    const text = element.find(".a-offscreen").first().text();
    const whole = element.find(".a-price-whole").first().text().replace(/[^\d]/g, "");
    const fraction = element.find(".a-price-fraction").first().text().replace(/[^\d]/g, "");
    const match = text.match(/(?:AU?|A)?\$\s*([\d,]+(?:\.\d{2})?)/);
    const value = match ? Number(match[1].replaceAll(",", "")) : whole ? Number(whole + "." + (fraction || "00")) : NaN;
    if (Number.isFinite(value) && value >= 1) values.add(Math.round(value * 100) / 100);
  });
  return values.size === 1 ? [...values][0] : null;
}

export function referenceAmazonOfferRoot(root: Cheerio<AnyNode>, mode: AmazonPriceTrackingMode): AmazonOfferRootReference {
  return { mode, id: root.attr("id") ?? null };
}
