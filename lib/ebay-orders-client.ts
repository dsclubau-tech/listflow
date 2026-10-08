import "server-only";
import {
  EBAY_API_BASE_URL, clearOAuthAccessTokenCache, getOAuthAccessToken,
} from "@/lib/ebay";
import { recordEbayRateLimitBackoff, waitForEbayRateLimit } from "@/lib/ebay-rate-limit";
import { EBAY_ORDERS_PAGE_SIZE, type EbayOrdersPage } from "@/lib/ebay-orders-import";

export class EbayOrdersRequestError extends Error {
  constructor(message: string, public readonly retryAfterMs = 5 * 60_000) { super(message); }
}

export async function fetchEbayOrdersPage(input: {
  storeId: string; storeNumber: 1 | 2 | 3; filter: string; offset: number;
}): Promise<EbayOrdersPage> {
  const url = new URL(EBAY_API_BASE_URL + "/sell/fulfillment/v1/order");
  url.search = new URLSearchParams({
    filter: input.filter, limit: String(EBAY_ORDERS_PAGE_SIZE), offset: String(input.offset),
  }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForEbayRateLimit(input.storeId, "FULFILLMENT");
    let token: string;
    try { token = await getOAuthAccessToken(input.storeNumber); }
    catch {
      throw new EbayOrdersRequestError("eBay order access is unavailable. Check the store connection and fulfillment permission.");
    }
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 && attempt === 0) {
      clearOAuthAccessTokenCache(input.storeNumber);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new EbayOrdersRequestError("eBay order access needs authorization. Reauthorize the store connection with fulfillment read permission.");
    }
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const seconds = header === null ? NaN : Number(header);
      const retryAfterMs = Number.isFinite(seconds) ? Math.max(5 * 60_000, seconds * 1_000)
        : Math.max(5 * 60_000, (header ? Date.parse(header) : NaN) - Date.now() || 0);
      const error = new EbayOrdersRequestError("eBay is temporarily limiting order requests.", retryAfterMs);
      await recordEbayRateLimitBackoff(input.storeId, "FULFILLMENT", error, retryAfterMs);
      throw error;
    }
    if (!response.ok) throw new EbayOrdersRequestError("eBay order request failed (HTTP " + response.status + ").");
    return await response.json() as EbayOrdersPage;
  }
  throw new EbayOrdersRequestError("eBay order authorization could not be refreshed.");
}
