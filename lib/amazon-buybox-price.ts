import {
  resolveAmazonOfferRoots, amazonOfferItemPrice, referenceAmazonOfferRoot,
  AMAZON_HIDDEN_OFFER, AMAZON_NON_NEW_OFFER, type AmazonOfferRootReference,
} from "./amazon-offer-roots";
import type { CheerioAPI } from "cheerio";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import { extractAmazonShippingFeeFromCheerio } from "@/lib/amazon-shipping";

const SCRAPER_MIN_PRICE = 1;

const DEAL_PRICE_LABEL_PATTERN =
  /deal price|lightning(?:\s+|\s*-\s*)deal|limited(?:\s+|\s*-\s*)time(?:\s+|\s*-\s*)deal|exclusive prime price|prime exclusive price|exclusive prime|prime deal|prime member price/i;
const LIGHTNING_DEAL_LABEL_PATTERN = /lightning(?:\s+|\s*-\s*)deal/i;
const PRIME_MEMBER_PRICE_LABEL_PATTERN = /prime member price/i;
const REGULAR_PRICE_LABEL_PATTERN = /regular price/i;
const LIMITED_TIME_DEAL_LABEL_PATTERN = /limited(?:\s+|\s*-\s*)time(?:\s+|\s*-\s*)deal/i;
// Delivery advertising may mention Prime; only offer eligibility/upsell language
// disqualifies a public promotion. Dedicated offer cards are checked separately.
const RESTRICTED_OFFER_PATTERN = /exclusive\s+prime|prime\s+(?:exclusive|member|deal|price|only|big\s+deal)|with\s+prime|(?:only|exclusiv\w*)\s+for\s+(?:amazon\s+)?prime|join\s+prime|subscribe\s*(?:&|and)\s*save|subscription|business\s+(?:price|exclusive)/i;
const NON_NEW_OFFER_PATTERN = /\bused\b|\brenewed\b|\brefurbished\b|\bsecond[ -]hand\b/i;
const SEPARATE_OR_RESTRICTED_OFFER_SELECTOR = [
  '[data-csa-c-buying-option-type]:not([data-csa-c-buying-option-type="NEW" i])',
  '[id*="primeSavingsUpsell" i]',
  '[id*="dealAccordion" i]',
  '[id*="usedAccordion" i]',
].join(",");

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
  AMAZON_HIDDEN_OFFER,
  AMAZON_NON_NEW_OFFER,
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
  '[data-csa-c-buying-option-type="USED" i]',
  '[data-csa-c-buying-option-type="RENEWED" i]',
  '[data-csa-c-buying-option-type="REFURBISHED" i]',
  '[id*="usedAccordion" i]',
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
  offerRoot?: AmazonOfferRootReference;
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

function currentOfferText(container: ReturnType<CheerioAPI>) {
  const copy = container.clone();
  copy.find(NON_CURRENT_PRICE_ANCESTOR_SELECTOR).remove();
  return normalizeText(copy.text());
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

function parseContainerBuyboxPrice($: CheerioAPI, container: ReturnType<CheerioAPI>): number | null {
  for (const sel of [
    ".apex-core-price-identifier .apex-pricetopay-value",
    ".apex-pricetopay-value",
    ".priceToPay",
    ".header-price",
    ".a-price:not(.a-text-price)",
    ".a-price",
  ]) {
    const elements = container.find(sel);
    for (let i = 0; i < elements.length; i++) {
      const el = elements.eq(i);
      if (el.closest(NON_CURRENT_PRICE_ANCESTOR_SELECTOR).length > 0) {
        continue;
      }
      const p = parsePriceElement($, el);
      if (p !== null) return p;
    }
  }
  return null;
}

const BUYBOX_FALLBACK_REGION_SELECTORS = [
  "#apex_desktop",
  "#corePrice_feature_div",
  "#buybox",
  "#desktop_buybox",
] as const;

function fallbackBuyboxPriceSweep(
  $: CheerioAPI,
  asin: string,
  shippingFee: number | null
): AmazonBuyboxPriceResult | null {
  for (const containerSelector of BUYBOX_FALLBACK_REGION_SELECTORS) {
    const container = $(containerSelector).first();
    if (container.length === 0) {
      continue;
    }

    let foundResult: AmazonBuyboxPriceResult | null = null;

    container.find("span, div, b, strong, p").each((_, element) => {
      if (foundResult) {
        return false;
      }

      const el = $(element);

      if (el.closest(NON_CURRENT_PRICE_ANCESTOR_SELECTOR).length > 0) {
        return;
      }

      const directText = el.clone().children().remove().end().text().trim() || el.text().trim();
      if (!directText || directText.length > 30) {
        return;
      }

      if (/coupon|save\s+\$|\boff\b/i.test(directText)) {
        return;
      }

      const price = parseFirstPriceFromText(directText);
      if (price !== null && price >= SCRAPER_MIN_PRICE) {
        console.info(
          `[amazon/buybox] Fallback buybox currency sweep matched price for ${asin}: $${price} (${containerSelector})`
        );
        foundResult = buildResult(
          asin,
          containerSelector,
          "fallback:currency-sweep",
          price,
          "REGULAR",
          "Regular price",
          shippingFee,
        );
        return false;
      }
    });

    if (foundResult) {
      return foundResult;
    }
  }

  return null;
}

function extractBuyboxPriceChoices(
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

  // 1. Check for Buybox Accordion cards / Multi-offer rows (e.g. Prime Member Price vs Regular Price)
  const buybox = $("#buyBoxAccordion, #desktop_buybox, #buybox");
  if (buybox.length > 0) {
    const accordionContainerSelector =
      buybox.filter("#buyBoxAccordion").length > 0
        ? "#buyBoxAccordion"
        : buybox.filter("#desktop_buybox").length > 0
          ? "#desktop_buybox"
          : "#buybox";

    const dealRoots = resolveAmazonOfferRoots($, "DEAL");
    const regularRoots = resolveAmazonOfferRoots($, "REGULAR");
    const primeCard = dealRoots.length === 1 ? dealRoots : dealRoots.filter(() => false);
    const regularCard = regularRoots.length === 1 ? regularRoots : regularRoots.filter(() => false);
    let primePrice = primeCard.length ? amazonOfferItemPrice($, primeCard) : null;
    let regularPrice = regularCard.length ? amazonOfferItemPrice($, regularCard) : null;

    if (regularPrice !== null && regularRoots.length === 1) {
      choices.regular = {
        ...buildResult(normalizedAsin, accordionContainerSelector, "buybox:regular-accordion",
          regularPrice, "REGULAR", "Regular price", shippingFee),
        offerRoot: referenceAmazonOfferRoot(regularCard, "REGULAR"),
      };
    }
    if (primePrice !== null && dealRoots.length === 1) {
      const text = normalizeText(primeCard.text());
      const label = LIGHTNING_DEAL_LABEL_PATTERN.test(text) ? "Lightning Deal" :
        /prime/i.test(primeCard.attr("id") ?? "") || PRIME_MEMBER_PRICE_LABEL_PATTERN.test(text)
          ? "Prime member price" : "Deal price";
      choices.deal = {
        ...buildResult(normalizedAsin, accordionContainerSelector, "buybox:deal-accordion",
          primePrice, "DEAL", label, shippingFee),
        offerRoot: referenceAmazonOfferRoot(primeCard, "DEAL"),
      };
    }
    // Also check labelled accordion rows / cards
    if (primePrice === null || regularPrice === null) {
      buybox.find(".a-box, .a-accordion-row")
        .filter((_, el) => !$(el).closest(AMAZON_HIDDEN_OFFER + ", " + AMAZON_NON_NEW_OFFER).length)
        .each((_, el) => {
        const row = $(el);
        const text = normalizeText(row.text());
        if (primePrice === null && DEAL_PRICE_LABEL_PATTERN.test(text)) {
          primePrice = parseContainerBuyboxPrice($, row);
        }
        if (regularPrice === null && REGULAR_PRICE_LABEL_PATTERN.test(text)) {
          regularPrice = parseContainerBuyboxPrice($, row);
        }
      });
    }

    if (primePrice !== null && regularPrice !== null) {
      const isPrimeSavingsCard =
        primeCard.length > 0 &&
        (
          (primeCard.attr("data-csa-c-buying-option-type") || "").toUpperCase() === "PRIME_SAVINGS_UPSELL" ||
          /primeSavingsUpsell/i.test(primeCard.attr("id") || "")
        );

      let dealLabel: string;
      if (isPrimeSavingsCard) {
        dealLabel = "Prime member price";
      } else {
        const dealCardText = normalizeText(
          (primeCard.length > 0 ? primeCard.text() : "") +
          " " +
          buybox.find(".a-box, .a-accordion-row").filter((_, el) => {
            const t = normalizeText($(el).text());
            return DEAL_PRICE_LABEL_PATTERN.test(t) && !REGULAR_PRICE_LABEL_PATTERN.test(t);
          }).first().text()
        );
        dealLabel = LIGHTNING_DEAL_LABEL_PATTERN.test(dealCardText)
          ? "Lightning Deal"
          : PRIME_MEMBER_PRICE_LABEL_PATTERN.test(dealCardText)
            ? "Prime member price"
            : "Deal price";
      }

      choices.deal ??= buildResult(
        normalizedAsin,
        accordionContainerSelector,
        "buybox:deal-accordion",
        primePrice,
        "DEAL",
        dealLabel,
        shippingFee,
      );
      choices.regular ??= buildResult(
        normalizedAsin,
        accordionContainerSelector,
        "buybox:regular-accordion",
        regularPrice,
        "REGULAR",
        "Regular price",
        shippingFee,
      );
      return choices;
    }
  }

  for (const containerSelector of BUYBOX_PRICE_CONTAINER_SELECTORS) {
    const container = $(containerSelector).first();
    if (container.length === 0) {
      continue;
    }

    const containerText = normalizeText(container.text());
    const priceSectionText = currentOfferText(container);
    const hasLabelledPriceSection =
      DEAL_PRICE_LABEL_PATTERN.test(priceSectionText) ||
      REGULAR_PRICE_LABEL_PATTERN.test(priceSectionText);
    const labelledDeal = extractLabelledPrice(
      priceSectionText,
      DEAL_PRICE_LABEL_PATTERN,
      [REGULAR_PRICE_LABEL_PATTERN]
    );
    if (
      labelledDeal !== null &&
      (!choices.deal || (!choices.deal.offerRoot && !isLabelledPriceResult(choices.deal)))
    ) {
      choices.deal = buildResult(
        normalizedAsin,
        containerSelector,
        "label:deal-price",
        labelledDeal,
        "DEAL",
        PRIME_MEMBER_PRICE_LABEL_PATTERN.test(containerText)
          ? "Prime member price"
          : LIGHTNING_DEAL_LABEL_PATTERN.test(containerText)
            ? "Lightning Deal"
            : "Deal price",
        shippingFee,
      );
    }

    const labelledRegular = extractLabelledPrice(
      priceSectionText,
      REGULAR_PRICE_LABEL_PATTERN,
      [DEAL_PRICE_LABEL_PATTERN]
    );
    if (
      labelledRegular !== null &&
      (!choices.regular || (!choices.regular.offerRoot && !isLabelledPriceResult(choices.regular)))
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

        const buyingOptionElement = priceElement.closest("[data-csa-c-buying-option-type]");
        const buyingOptionType = (
          buyingOptionElement.attr("data-csa-c-buying-option-type") || ""
        ).toUpperCase();
        const isPrimeUpsellOption =
          buyingOptionType === "PRIME_SAVINGS_UPSELL" ||
          buyingOptionType === "DEAL" ||
          priceElement.closest(
            '#primeSavingsUpsellAccordionRow, [id*="primeSavingsUpsell" i], [id*="dealAccordion" i], [data-csa-c-buying-option-type="DEAL"]'
          ).length > 0;
        const isNewOption =
          buyingOptionType === "NEW" ||
          priceElement.closest('[id*="newAccordionRow" i], [id*="regularPrice" i]').length >
            0;

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
          isPrimeUpsellOption ||
          DEAL_PRICE_LABEL_PATTERN.test(localNearbyText) ||
          hasVerifiedSavingsDeal ||
          /with prime/i.test(localNearbyText);
        const localLooksRegular =
          isNewOption || REGULAR_PRICE_LABEL_PATTERN.test(localNearbyText);

        const containerLooksDeal =
          DEAL_PRICE_LABEL_PATTERN.test(containerText) ||
          hasVerifiedSavingsDeal ||
          /with prime/i.test(containerText);
        const containerLooksRegular =
          REGULAR_PRICE_LABEL_PATTERN.test(priceSectionText);

        let mode: AmazonPriceTrackingMode;
        if (selectorLooksDeal || isPrimeUpsellOption) {
          mode = "DEAL";
        } else if (isNewOption) {
          mode = "REGULAR";
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
          isPrimeUpsellOption ||
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
            isPrimeUpsellOption || PRIME_MEMBER_PRICE_LABEL_PATTERN.test(localNearbyText)
              ? "Prime member price"
              : LIGHTNING_DEAL_LABEL_PATTERN.test(localNearbyText) || LIGHTNING_DEAL_LABEL_PATTERN.test(containerText)
                ? "Lightning Deal"
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

  // Last-resort structural fallback: if all selectors missed,
  // sweep the buybox region for currency-formatted text.
  if (!choices.regular && !choices.deal) {
    const fallback = fallbackBuyboxPriceSweep($, normalizedAsin, shippingFee);
    if (fallback) {
      choices.regular = fallback;
    }
  }

  return choices;
}

function isPublicLimitedTimePrice(
  $: CheerioAPI,
  deal: AmazonBuyboxPriceResult,
) {
  const regions = $(BUYBOX_PRICE_CONTAINER_SELECTORS.join(",") + ",#buyBoxAccordion");
  const offerText = currentOfferText(regions);
  if (!LIMITED_TIME_DEAL_LABEL_PATTERN.test(offerText) ||
      RESTRICTED_OFFER_PATTERN.test(offerText) ||
      NON_NEW_OFFER_PATTERN.test(offerText) ||
      REGULAR_PRICE_LABEL_PATTERN.test(offerText) ||
      LIGHTNING_DEAL_LABEL_PATTERN.test(offerText) ||
      regions.find(SEPARATE_OR_RESTRICTED_OFFER_SELECTOR).length > 0) {
    return false;
  }

  // A deal label or crossed-out RRP alone is not an offer. Require one current
  // price in supported markup, allowing repeated displays of the same amount.
  // Conflicting amounts or unrecognized multi-offer layouts remain unverified.
  const currentPrices = new Set<number>();
  regions.find(BUYBOX_PRICE_VALUE_SELECTORS.join(",")).each((_, element) => {
    if ($(element).closest(NON_CURRENT_PRICE_ANCESTOR_SELECTOR).length > 0) return;
    const price = parsePriceElement($, element);
    if (price !== null) currentPrices.add(price);
  });
  return currentPrices.size === 1 && currentPrices.has(deal.itemPrice ?? deal.price);
}

export function extractLocalizedBuyboxPriceChoices(
  $: CheerioAPI,
  asin: string,
): AmazonBuyboxPriceChoices {
  const choices = extractBuyboxPriceChoices($, asin);
  if (!choices.regular && choices.deal && isPublicLimitedTimePrice($, choices.deal)) {
    // Preserve Deal tracking and the shipping-inclusive amount. This public
    // offer is also the regular purchase price; do not apply shipping again.
    choices.regular = { ...choices.deal, mode: "REGULAR", label: "Regular price" };
  }
  return choices;
}

export function selectAmazonBuyboxPriceForMode(
  choices: AmazonBuyboxPriceChoices,
  mode: AmazonPriceTrackingMode,
): AmazonBuyboxPriceResult | null {
  return mode === "DEAL" ? choices.deal : choices.regular;
}

/** Tracking may temporarily use the regular offer without changing the preference. */
export function selectAmazonBuyboxPriceForTracking(
  choices: AmazonBuyboxPriceChoices,
  mode: AmazonPriceTrackingMode,
): AmazonBuyboxPriceResult | null {
  return mode === "DEAL" ? choices.deal ?? choices.regular : choices.regular;
}

export function extractLocalizedBuyboxPriceForMode(
  $: CheerioAPI,
  asin: string,
  mode: AmazonPriceTrackingMode
): AmazonBuyboxPriceResult | null {
  const choices = extractLocalizedBuyboxPriceChoices($, asin);
  return selectAmazonBuyboxPriceForMode(choices, mode);
}

export function extractLocalizedBuyboxPrice(
  $: CheerioAPI,
  asin: string
): AmazonBuyboxPriceResult | null {
  const choices = extractLocalizedBuyboxPriceChoices($, asin);
  return choices.regular ?? choices.deal;
}
