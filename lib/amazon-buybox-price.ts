import type { CheerioAPI } from "cheerio";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";

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
  mode: AmazonPriceTrackingMode;
};

export type AmazonBuyboxPriceChoices = {
  asin: string | null;
  regular: AmazonBuyboxPriceResult | null;
  deal: AmazonBuyboxPriceResult | null;
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

function parseFirstPriceFromText(value: string): number | null {
  const match = value.match(/(?:A(?:U)?\$|\$)\s*[\d,]+(?:\.\d{2})?/i);
  return parseAmazonPriceValue(match?.[0]);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractLabelledPrice(
  text: string,
  labelPattern: RegExp,
  stopPatterns: RegExp[]
) {
  const normalized = normalizeText(text);
  const labelMatch = normalized.match(labelPattern);
  if (!labelMatch || labelMatch.index === undefined) {
    return null;
  }

  let section = normalized.slice(labelMatch.index + labelMatch[0].length);
  let stopAt = section.length;
  for (const pattern of stopPatterns) {
    const match = section.match(pattern);
    if (match?.index !== undefined && match.index >= 0) {
      stopAt = Math.min(stopAt, match.index);
    }
  }

  section = section.slice(0, stopAt);
  return parseFirstPriceFromText(section);
}

function buildResult(
  asin: string,
  containerSelector: string,
  selector: string,
  price: number,
  mode: AmazonPriceTrackingMode
): AmazonBuyboxPriceResult {
  return {
    asin: asin || null,
    containerSelector,
    price,
    priceSource: "localized_buybox",
    selector,
    mode,
  };
}

export function extractLocalizedBuyboxPriceChoices(
  $: CheerioAPI,
  asin: string
): AmazonBuyboxPriceChoices {
  const normalizedAsin = asin.trim().toUpperCase();
  const choices: AmazonBuyboxPriceChoices = {
    asin: normalizedAsin || null,
    regular: null,
    deal: null,
  };

  for (const containerSelector of BUYBOX_PRICE_CONTAINER_SELECTORS) {
    const container = $(containerSelector).first();
    if (container.length === 0) {
      continue;
    }

    const containerText = normalizeText(container.text());
    const labelledDeal = extractLabelledPrice(containerText, /deal price/i, [
      /regular price/i,
    ]);
    if (labelledDeal !== null && !choices.deal) {
      choices.deal = buildResult(
        normalizedAsin,
        containerSelector,
        "label:deal-price",
        labelledDeal,
        "DEAL"
      );
    }

    const labelledRegular = extractLabelledPrice(
      containerText,
      /regular price/i,
      [/deal price/i]
    );
    if (labelledRegular !== null && !choices.regular) {
      choices.regular = buildResult(
        normalizedAsin,
        containerSelector,
        "label:regular-price",
        labelledRegular,
        "REGULAR"
      );
    }

    for (const selector of BUYBOX_PRICE_VALUE_SELECTORS) {
      container.find(selector).each((_, element) => {
        if (choices.regular && choices.deal) {
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

        const nearbyText = normalizeText(
          [
            priceElement.parent().text(),
            priceElement.closest("div").text(),
            priceElement.closest("li, td, tr").text(),
          ].join(" ")
        );
        const selectorLooksDeal = selector.includes("dealprice");
        const contextLooksDeal = /deal price|prime exclusive|prime deal/i.test(
          nearbyText
        );
        const contextLooksRegular = /regular price/i.test(nearbyText);
        const mode: AmazonPriceTrackingMode =
          selectorLooksDeal || (contextLooksDeal && !contextLooksRegular)
            ? "DEAL"
            : "REGULAR";

        if (mode === "DEAL" && !choices.deal) {
          choices.deal = buildResult(
            normalizedAsin,
            containerSelector,
            selector,
            price,
            "DEAL"
          );
          return;
        }

        if (mode === "REGULAR" && !choices.regular) {
          choices.regular = buildResult(
            normalizedAsin,
            containerSelector,
            selector,
            price,
            "REGULAR"
          );
        }
      });

      if (choices.regular && choices.deal) {
        return choices;
      }
    }
  }

  return choices;
}

export function extractLocalizedBuyboxPriceForMode(
  $: CheerioAPI,
  asin: string,
  mode: AmazonPriceTrackingMode
): AmazonBuyboxPriceResult | null {
  const choices = extractLocalizedBuyboxPriceChoices($, asin);
  return mode === "DEAL" ? choices.deal : choices.regular;
}

export function extractLocalizedBuyboxPrice(
  $: CheerioAPI,
  asin: string
): AmazonBuyboxPriceResult | null {
  const choices = extractLocalizedBuyboxPriceChoices($, asin);
  return choices.regular ?? choices.deal;
}
