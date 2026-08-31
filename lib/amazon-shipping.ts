import { load, type CheerioAPI } from "cheerio";

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
    /(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\s*(?:[\w\s-]{0,20}?)(?:(?:international\s+)?delivery|shipping)\b/i
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
    /\b(?:(?:international\s+)?delivery|shipping)(?:[\w\s:-]{0,20}?)(?:A(?:U)?\$|US\$|\$)\s*([\d,]+\.\d{2})\b/i
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
    const elements = $(selector);
    for (let i = 0; i < elements.length; i++) {
      const text = $(elements[i]).text();
      const fee = parseAmazonShippingFeeFromText(text);
      if (fee !== null) {
        return fee;
      }
    }
  }

  return null;
}

/**
 * Fetches the dynamic international delivery fee from Amazon AU's Deep Check Promise (DCP) API
 * when the fee is loaded asynchronously via client-side JavaScript.
 */
export async function fetchAmazonDcpShippingFee(
  html: string,
  cookieHeader?: string
): Promise<number | null> {
  const dcpMatch = html.match(/var\s+dcpConfig\s*=\s*(\{[\s\S]*?\});/);
  if (!dcpMatch) {
    return null;
  }

  try {
    const configText = dcpMatch[1];
    const urlMatch = configText.match(/url:\s*"([^"]+)"/);
    const asinMatch = configText.match(/asin:\s*"([^"]+)"/);
    const slateTokenMatch = configText.match(/slateToken:\s*"([^"]+)"/);
    const csrfTokenMatch = configText.match(/csrfToken:\s*"([^"]+)"/);
    const sessionIdMatch = configText.match(/sessionId:\s*"([^"]+)"/);
    const requestIdMatch = configText.match(/requestId:\s*"([^"]+)"/);
    const marketplaceIdMatch = configText.match(/marketplaceId:\s*"([^"]+)"/);
    const merchantIdMatch = configText.match(/merchantId:\s*"([^"]+)"/);

    const dcpUrl = urlMatch?.[1] || "https://dcp.amazon.com.au/dcp";
    const csrfToken = csrfTokenMatch?.[1] || "";
    const asin = asinMatch?.[1] || "";
    const slateToken = slateTokenMatch?.[1] || "";

    if (!slateToken || !asin || !csrfToken) {
      return null;
    }

    const payload = {
      asin,
      buyingOptionIndex: "0",
      buyingOptionType: "NEW",
      customerId: "",
      device: "DESKTOP",
      marketplaceId: marketplaceIdMatch?.[1] || "A39IBJ37TRP1C6",
      merchantId: merchantIdMatch?.[1] || "",
      requestId: requestIdMatch?.[1] || "",
      sessionId: sessionIdMatch?.[1] || "",
      slateToken,
      currencyOfPreference: "",
    };

    const res = await fetch(dcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "csrf-token": csrfToken,
        "accept": "text/html,*/*",
        "x-requested-with": "XMLHttpRequest",
        "referer": `https://www.amazon.com.au/dp/${asin}`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return null;
    }

    const responseHtml = await res.text();
    const priceAttrMatch = responseHtml.match(
      /data-csa-c-delivery-price="([^"]+)"/
    );
    if (priceAttrMatch?.[1]) {
      const parsed = parseAmazonShippingFeeFromText(priceAttrMatch[1]);
      if (parsed !== null) return parsed;
    }

    const $snippet = load(responseHtml);
    const feeFromSnippet = parseAmazonShippingFeeFromText($snippet.text());
    if (feeFromSnippet !== null) {
      return feeFromSnippet;
    }
  } catch {
    return null;
  }

  return null;
}
