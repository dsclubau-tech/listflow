import type { CheerioAPI } from "cheerio";

const DELIVERY_SELECTORS = [
  "#deliveryBlockMessage",
  "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE",
  "#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE",
  "#amazonGlobal_feature_div",
  "#delivery-message",
  "#ourprice_shippingmessage",
  "#price-shipping-message",
  "#freeShippingRegion",
  "#aod-offer-shipping",
  "#buybox",
  "#desktop_buybox",
  "#apex_desktop",
] as const;

/**
 * Parses Amazon AU delivery / shipping cost from raw delivery message text.
 * Handles both domestic shipping ("$9.95 delivery", "FREE delivery") and
 * international shipping ("$69.37 International delivery").
 */
export function parseAmazonShippingFeeFromText(
  text: string | null | undefined
): number | null {
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  // 1. Check for explicit paid delivery / shipping costs first
  // E.g. "$69.37 International delivery", "A$69.37 International delivery", "$9.95 delivery", "AU$12.50 shipping"
  const priceBeforeDeliveryMatch = normalized.match(
    /(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\s*(?:(?:international\s+)?delivery|shipping)\b/i
  );
  if (priceBeforeDeliveryMatch?.[1]) {
    const parsed = Number.parseFloat(
      priceBeforeDeliveryMatch[1].replace(/,/g, "")
    );
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  // E.g. "Delivery: $9.95", "International delivery: $69.37", "Shipping fee: $14.00"
  const deliveryBeforePriceMatch = normalized.match(
    /\b(?:(?:international\s+)?delivery|shipping)(?:\s+fee|\s+cost)?\s*[:\-]?\s*(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\b/i
  );
  if (deliveryBeforePriceMatch?.[1]) {
    const parsed = Number.parseFloat(
      deliveryBeforePriceMatch[1].replace(/,/g, "")
    );
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  // E.g. "+ $69.37 delivery", "+ $12.00 shipping", "+ $25.00" (inside a delivery block)
  const plusDeliveryMatch = normalized.match(
    /\+\s*(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\s*(?:(?:international\s+)?delivery|shipping)?\b/i
  );
  if (plusDeliveryMatch?.[1]) {
    const parsed = Number.parseFloat(plusDeliveryMatch[1].replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 100) / 100;
    }
  }

  // 2. Check for free delivery
  // E.g. "FREE delivery", "FREE International delivery", "FREE delivery for Prime members"
  if (
    /\bFREE(?:\s+international)?\s+delivery\b/i.test(normalized) ||
    /\bFREE\s+shipping\b/i.test(normalized)
  ) {
    return 0;
  }

  return null;
}

/**
 * Extracts shipping/delivery fee from parsed Cheerio HTML.
 */
export function extractAmazonShippingFeeFromCheerio(
  $: CheerioAPI
): number | null {
  for (const selector of DELIVERY_SELECTORS) {
    const element = $(selector).first();
    if (element.length === 0) continue;

    const text = element.text();
    const fee = parseAmazonShippingFeeFromText(text);
    if (fee !== null) {
      return fee;
    }
  }

  return null;
}
