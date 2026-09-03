import type { CheerioAPI } from "cheerio";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import { extractAmazonShippingFeeFromCheerio } from "@/lib/amazon-shipping";

const SCRAPER_MIN_PRICE = 1;

const DEAL_PRICE_LABEL_PATTERN =
  /deal price|limited(?:\s+|\s*-\s*)time(?:\s+|\s*-\s*)deal|exclusive prime price|prime exclusive price|exclusive prime|prime deal|prime member price/i;
const PRIME_MEMBER_PRICE_LABEL_PATTERN = /prime member price/i;
const REGULAR_PRICE_LABEL_PATTERN = /regular price/i;

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

const REFERENCE_PRICE_SELECTORS = [
  ".basisPrice .a-offscreen",
  ".a-price.a-text-price .a-offscreen",
  "#listPrice .a-offscreen",
  "#regularprice_savings .a-offscreen",
].join(",");

export type AmazonBuyboxPriceResult = {
  asin: string | null;
  containerSelector: string;
  price: number;
  itemPrice?: number;
  shippingFee?: number | null;
  priceSource: "localized_buybox" | "rendered_selected_variant_buybox";
  selector: string;
  mode: AmazonPriceTrackingMode;
  label: string;
};

export type AmazonBuyboxPriceChoices = {
  asin: string | null;
  shippingFee?: number | null;
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

function hasPositiveSavingsPercentage(value: string) {
  const match = normalizeText(value).match(
    /(?:-\s*(\d+(?:\.\d+)?)\s*%|\b(\d+(?:\.\d+)?)\s*%\s*off\b)/i,
  );
  const percentage = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(percentage) && percentage > 0;
}

function hasHigherReferencePrice(
  $: CheerioAPI,
  containerSelector: string,
  currentPrice: number,
) {
  let found = false;

  $(containerSelector)
    .first()
    .find(REFERENCE_PRICE_SELECTORS)
    .each((_, element) => {
      const referencePrice = parseAmazonPriceValue($(element).text());
      if (referencePrice !== null && referencePrice > currentPrice) {
        found = true;
        return false;
      }
    });

  return found;
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
  mode: AmazonPriceTrackingMode,
  label = mode === "DEAL" ? "Deal price" : "Regular price",
  shippingFee: number | null = null,
): AmazonBuyboxPriceResult {
  const itemPrice = price;
  const effectivePrice =
    shippingFee !== null && shippingFee > 0
      ? Math.round((price + shippingFee) * 100) / 100
      : price;

  return {
    asin: asin || null,
    containerSelector,
    price: effectivePrice,
    itemPrice,
    shippingFee,
    priceSource: "localized_buybox",
    selector,
    mode,
    label,
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
  const shippingFee = extractAmazonShippingFeeFromCheerio($);
  const choices: AmazonBuyboxPriceChoices = {
    asin: normalizedAsin || null,
    shippingFee,
    regular: null,
    deal: null,
  };

  for (const containerSelector of BUYBOX_PRICE_CONTAINER_SELECTORS) {
    const container = $(containerSelector).first();
    if (container.length === 0) {
      continue;
    }

    const containerText = normalizeText(container.text());
    const hasLabelledPriceSection =
      DEAL_PRICE_LABEL_PATTERN.test(containerText) ||
      REGULAR_PRICE_LABEL_PATTERN.test(containerText);
    const labelledDeal = extractLabelledPrice(
      containerText,
      DEAL_PRICE_LABEL_PATTERN,
      [REGULAR_PRICE_LABEL_PATTERN]
    );
    if (
      labelledDeal !== null &&
      (!choices.deal || !isLabelledPriceResult(choices.deal))
    ) {
      choices.deal = buildResult(
        normalizedAsin,
        containerSelector,
        "label:deal-price",
        labelledDeal,
        "DEAL",
        PRIME_MEMBER_PRICE_LABEL_PATTERN.test(containerText)
          ? "Prime member price"
          : "Deal price",
        shippingFee,
      );
    }

    const labelledRegular = extractLabelledPrice(
      containerText,
      REGULAR_PRICE_LABEL_PATTERN,
      [DEAL_PRICE_LABEL_PATTERN]
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
        "REGULAR",
        "Regular price",
        shippingFee,
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

        const hasVerifiedSavingsDeal =
          hasPositiveSavingsPercentage(containerText) &&
          hasHigherReferencePrice($, containerSelector, price);

        const localNearbyText = normalizeText(
          [
            priceElement.parent().text(),
            priceElement
              .closest(
                ".a-accordion-row, .a-box, [class*='accordion'], li, td, tr, div:not(#corePrice_feature_div):not(#corePriceDisplay_desktop_feature_div):not(#apex_desktop):not(#buybox):not(#desktop_buybox)"
              )
              .text(),
          ].join(" ")
        );
        const selectorLooksDeal = selector.includes("dealprice");
        const localLooksDeal =
          DEAL_PRICE_LABEL_PATTERN.test(localNearbyText) ||
          hasVerifiedSavingsDeal ||
          /with prime/i.test(localNearbyText);
        const localLooksRegular =
          REGULAR_PRICE_LABEL_PATTERN.test(localNearbyText);

        const containerLooksDeal =
          DEAL_PRICE_LABEL_PATTERN.test(containerText) ||
          hasVerifiedSavingsDeal ||
          /with prime/i.test(containerText);
        const containerLooksRegular =
          REGULAR_PRICE_LABEL_PATTERN.test(containerText);

        let mode: AmazonPriceTrackingMode;
        if (selectorLooksDeal) {
          mode = "DEAL";
        } else if (localLooksDeal && !localLooksRegular) {
          mode = "DEAL";
        } else if (localLooksRegular && !localLooksDeal) {
          mode = "REGULAR";
        } else if (containerLooksDeal && !containerLooksRegular) {
          mode = "DEAL";
        } else if (containerLooksRegular && !containerLooksDeal) {
          mode = "REGULAR";
        } else {
          mode = "REGULAR";
        }

        const isExplicitDeal =
          selectorLooksDeal ||
          DEAL_PRICE_LABEL_PATTERN.test(localNearbyText) ||
          DEAL_PRICE_LABEL_PATTERN.test(containerText) ||
          /with prime/i.test(localNearbyText) ||
          /with prime/i.test(containerText);

        if (mode === "DEAL" && !choices.deal) {
          choices.deal = buildResult(
            normalizedAsin,
            containerSelector,
            selector,
            price,
            "DEAL",
            PRIME_MEMBER_PRICE_LABEL_PATTERN.test(localNearbyText)
              ? "Prime member price"
              : hasVerifiedSavingsDeal
                ? "Discounted price"
                : "Deal price",
            shippingFee,
          );

          // If this is a general discount against an RRP/reference price
          // (not an explicit limited-time deal or prime exclusive), this single
          // buybox price is also the regular purchasable price on Amazon.
          if (!isExplicitDeal && !choices.regular) {
            choices.regular = buildResult(
              normalizedAsin,
              containerSelector,
              selector,
              price,
              "REGULAR",
              "Regular price",
              shippingFee,
            );
          }

          if (isExplicitDeal) {
            return;
          }
        }

        if (mode === "REGULAR" && !choices.regular) {
          choices.regular = buildResult(
            normalizedAsin,
            containerSelector,
            selector,
            price,
            "REGULAR",
            "Regular price",
            shippingFee,
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
