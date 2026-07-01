import type { CheerioAPI } from "cheerio";

const SCRAPER_MIN_PRICE = 1;

const BUYBOX_PRICE_CONTAINER_SELECTORS = [
  "#corePrice_feature_div",
  "#corePriceDisplay_desktop_feature_div",
  "#apex_desktop",
  "#buybox",
  "#desktop_buybox",
] as const;

const BUYBOX_PRICE_VALUE_SELECTORS = [
  ".priceToPay .a-offscreen",
  ".apexPriceToPay .a-offscreen",
  ".a-price.priceToPay .a-offscreen",
  ".a-price.apexPriceToPay .a-offscreen",
  'span.a-price[data-a-color="price"]:not(.a-text-price) .a-offscreen',
  'span.a-price[data-a-color="base"]:not(.a-text-price) .a-offscreen',
  ".a-price:not(.a-text-price) .a-offscreen",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  "#price_inside_buybox",
] as const;

const NON_CURRENT_PRICE_ANCESTOR_SELECTOR = [
  ".a-text-price",
  ".basisPrice",
  ".coupon",
  ".couponBadge",
  ".promoPriceBlockMessage",
  ".reinventPriceSavingsPercentageMargin",
  ".savingsPercentage",
  "#dealprice_savings",
  "#listPrice",
  "#regularprice_savings",
  "#sns-base-price",
  '[class*="coupon"]',
  '[id*="coupon"]',
].join(",");

export type AmazonBuyboxPriceResult = {
  asin: string | null;
  containerSelector: string;
  price: number;
  priceSource: "localized_buybox";
  selector: string;
};

function parseAmazonPriceValue(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d.,]/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < SCRAPER_MIN_PRICE) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

export function extractLocalizedBuyboxPrice(
  $: CheerioAPI,
  asin: string
): AmazonBuyboxPriceResult | null {
  const normalizedAsin = asin.trim().toUpperCase();

  for (const containerSelector of BUYBOX_PRICE_CONTAINER_SELECTORS) {
    const container = $(containerSelector).first();
    if (container.length === 0) {
      continue;
    }

    for (const selector of BUYBOX_PRICE_VALUE_SELECTORS) {
      let result: AmazonBuyboxPriceResult | null = null;

      container.find(selector).each((_, element) => {
        if (result) {
          return false;
        }

        const priceElement = $(element);
        if (priceElement.closest(NON_CURRENT_PRICE_ANCESTOR_SELECTOR).length > 0) {
          return;
        }

        const price = parseAmazonPriceValue(priceElement.text());
        if (price === null) {
          return;
        }

        result = {
          asin: normalizedAsin || null,
          containerSelector,
          price,
          priceSource: "localized_buybox",
          selector,
        };
      });

      if (result) {
        return result;
      }
    }
  }

  return null;
}
