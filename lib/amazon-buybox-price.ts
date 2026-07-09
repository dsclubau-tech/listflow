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
  ".priceToPay",
  ".apexPriceToPay",
  ".a-price.priceToPay",
  ".a-price.apexPriceToPay",
  'span.a-price[data-a-color="price"]:not(.a-text-price)',
  'span.a-price[data-a-color="base"]:not(.a-text-price)',
  ".a-price:not(.a-text-price)",
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
  const match = value.match(
    /(?:A(?:U)?\$|\$)\s*([\d,]+)(?:(?:\.|\s+)(\d{2}))?/i
  );
  if (!match) {
    return null;
  }

  const [, whole, cents] = match;
  if (!cents && !whole.includes(",") && whole.replace(/\D/g, "").length > 3) {
    return null;
  }

  return parseAmazonPriceValue(`${whole}${cents ? `.${cents}` : ""}`);
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

function isLabelledPriceResult(result: AmazonBuyboxPriceResult | null) {
  return result?.selector.startsWith("label:") ?? false;
}

function parsePriceElement(
  $: CheerioAPI,
  element: Parameters<CheerioAPI>[0]
) {
  const priceElement = $(element);
  const offscreen = priceElement.find(".a-offscreen").first().text();
  const offscreenPrice = parseAmazonPriceValue(offscreen);
  if (offscreenPrice !== null) {
    return offscreenPrice;
  }

  const whole = priceElement.find(".a-price-whole").first().text();
  if (whole) {
    const wholeDigits = whole.replace(/[^\d,]/g, "").replace(/,/g, "");
    const fractionDigits = priceElement
      .find(".a-price-fraction")
      .first()
      .text()
      .replace(/\D/g, "")
      .slice(0, 2);
    if (wholeDigits) {
      const price = parseAmazonPriceValue(
        `${wholeDigits}.${fractionDigits.padEnd(2, "0") || "00"}`
      );
      if (price !== null) {
        return price;
      }
    }
  }

  return parseFirstPriceFromText(priceElement.text());
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
    const hasLabelledPriceSection = /deal price|regular price/i.test(
      containerText
    );
    const labelledDeal = extractLabelledPrice(containerText, /deal price/i, [
      /regular price/i,
    ]);
    if (
      labelledDeal !== null &&
      (!choices.deal || !isLabelledPriceResult(choices.deal))
    ) {
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
    if (
      labelledRegular !== null &&
      (!choices.regular || !isLabelledPriceResult(choices.regular))
    ) {
      choices.regular = buildResult(
        normalizedAsin,
        containerSelector,
        "label:regular-price",
        labelledRegular,
        "REGULAR"
      );
    }

    if (hasLabelledPriceSection && choices.regular && choices.deal) {
      return choices;
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

        const price = parsePriceElement($, element);
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
        if (
          hasLabelledPriceSection &&
          contextLooksDeal &&
          contextLooksRegular
        ) {
          return;
        }

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
