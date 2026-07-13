/**
 * eBay API configuration — single source of truth for all eBay endpoints.
 * Import from `@/lib/ebay` in any API route that needs to call eBay.
 *
 * Reads EBAY_ENVIRONMENT from env:
 *   "production" → api.ebay.com
 *   anything else → api.sandbox.ebay.com
 */

import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  isEbayRateLimitError,
  recordEbayRateLimitBackoff,
  waitForEbayRateLimit,
  type EbayRateLimitKind,
} from "@/lib/ebay-rate-limit";

const isProduction = process.env.EBAY_ENVIRONMENT === "production";

export const EBAY_API_BASE_URL = isProduction
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

export const EBAY_API_ENDPOINT = `${EBAY_API_BASE_URL}/ws/api.dll`;

export const ebayConfig = {
  baseUrl: EBAY_API_BASE_URL,
  appId: process.env.EBAY_APP_ID || "",
  devId: process.env.EBAY_DEV_ID || "",
  certId: process.env.EBAY_CERT_ID || "",
  environment: isProduction ? "production" : "sandbox",
} as const;

type EbayErrorNode = {
  ShortMessage?: unknown;
  LongMessage?: unknown;
  ErrorCode?: unknown;
  ErrorParameters?: unknown;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function decodeEbayText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function cleanEbayText(value: unknown) {
  return decodeEbayText(textValue(value))
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<font\b[^>]*>.*?<\/font>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\{[a-z0-9-]+x\}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getErrorParameterValues(error: EbayErrorNode) {
  return asArray(error.ErrorParameters)
    .map((parameter) => {
      if (!parameter || typeof parameter !== "object") {
        return "";
      }

      return cleanEbayText((parameter as { Value?: unknown }).Value);
    })
    .filter((value) => {
      if (!value || /^\d+$/.test(value) || /^\{[^}]+\}$/.test(value)) {
        return false;
      }

      if (/^https?:\/\//i.test(value) || /^PI_/i.test(value)) {
        return false;
      }

      return true;
    });
}

function uniqueMessages(messages: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const message of messages) {
    const normalized = message.toLowerCase();
    if (!message || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(message);
  }

  return unique;
}

function formatEbayApiErrors(errors: unknown, fallback?: unknown) {
  const messages = asArray(errors as EbayErrorNode | EbayErrorNode[])
    .flatMap((error) => {
      if (!error || typeof error !== "object") {
        return [cleanEbayText(error)];
      }

      const errorNode = error as EbayErrorNode;
      const parameterValues = getErrorParameterValues(errorNode);
      const explanatoryParameters = parameterValues.filter(
        (value) => value.length > 25 && /\s/.test(value),
      );
      const shortParameters = parameterValues.filter(
        (value) => !explanatoryParameters.includes(value),
      );

      return [
        ...explanatoryParameters,
        cleanEbayText(errorNode.LongMessage),
        cleanEbayText(errorNode.ShortMessage),
        ...shortParameters,
      ];
    })
    .filter(Boolean);

  const fallbackMessage = cleanEbayText(fallback);
  const unique = uniqueMessages(fallbackMessage ? [...messages, fallbackMessage] : messages);

  return unique.length > 0 ? unique.join("; ") : "Unknown eBay error";
}

/**
 * Gets the static eBay token for a specific store from environment variables.
 */
export function getEbayToken(storeName: string): string {
  if (storeName === "Store 1") return process.env.EBAY_STORE1_TOKEN || "";
  if (storeName === "Store 2") return process.env.EBAY_STORE2_TOKEN || "";
  if (storeName === "Store 3") return process.env.EBAY_STORE3_TOKEN || "";
  return "";
}

/**
 * Maps a database store ID (CUID) to a store number (1, 2, or 3).
 * Fetches the store name from the database and extracts the number.
 */
export async function getStoreNumber(storeId: string): Promise<1 | 2 | 3> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });

  if (!store) {
    throw new Error(`Store not found: ${storeId}`);
  }

  if (store.name === "Store 1") return 1;
  if (store.name === "Store 2") return 2;
  if (store.name === "Store 3") return 3;

  throw new Error(`Unknown store name: ${store.name}`);
}

/**
 * Returns the credentials object for a given store number.
 */
export function getStoreCredentials(storeNumber: 1 | 2 | 3) {
  const refreshTokenMap: Record<number, string> = {
    1: process.env.EBAY_STORE1_TOKEN || "",
    2: process.env.EBAY_STORE2_TOKEN || "",
    3: process.env.EBAY_STORE3_TOKEN || "",
  };

  return {
    refreshToken: refreshTokenMap[storeNumber],
    appId: ebayConfig.appId,
    devId: ebayConfig.devId,
    certId: ebayConfig.certId,
  };
}

async function getStoreIdForStoreNumber(storeNumber: 1 | 2 | 3) {
  const store = await prisma.store.findFirst({
    where: { name: `Store ${storeNumber}` },
    select: { id: true },
  });

  return store?.id ?? null;
}

async function waitForStoreEbayLimit(
  storeNumber: 1 | 2 | 3,
  kind: EbayRateLimitKind
) {
  const storeId = await getStoreIdForStoreNumber(storeNumber);

  if (storeId) {
    await waitForEbayRateLimit(storeId, kind);
  }

  return storeId;
}

async function recordStoreEbayBackoff(
  storeId: string | null,
  kind: EbayRateLimitKind,
  error: unknown
) {
  if (storeId && isEbayRateLimitError(error)) {
    await recordEbayRateLimitBackoff(storeId, kind, error).catch(() => undefined);
  }
}

/**
 * Exchanges an OAuth Refresh Token for a short-lived Access Token.
 * Uses the eBay Identity API with client_credentials or refresh_token grant.
 */
export async function getOAuthAccessToken(storeNumber: 1 | 2 | 3): Promise<string> {
  const creds = getStoreCredentials(storeNumber);

  if (!creds.refreshToken) {
    throw new Error(`No refresh token configured for Store ${storeNumber}`);
  }
  if (!creds.appId || !creds.certId) {
    throw new Error("EBAY_APP_ID or EBAY_CERT_ID not set in environment");
  }

  // Basic auth = base64(appId:certId)
  const basicAuth = Buffer.from(`${creds.appId}:${creds.certId}`).toString("base64");

  const oauthBase = isProduction
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

  const response = await fetch(`${oauthBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.marketing",
        "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      ].join(" "),
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("ebay/getOAuthAccessToken", `Token exchange failed (HTTP ${response.status})`, undefined, {
      storeNumber,
      status: response.status,
      responseBody: text,
    });
    throw new Error(`eBay OAuth token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token?: string; error_description?: string };

  if (!data.access_token) {
    logger.error("ebay/getOAuthAccessToken", "Token exchange returned no access_token", undefined, {
      storeNumber,
      responseData: data,
    });
    throw new Error(`eBay OAuth returned no access_token: ${data.error_description ?? JSON.stringify(data)}`);
  }

  logger.info("ebay/getOAuthAccessToken", "Token exchange succeeded", { storeNumber });

  return data.access_token;
}

type EbayPromotedRateStrategy = "FIXED" | "DYNAMIC" | "UNKNOWN";

type EbayMarketingCampaignResponse = {
  campaigns?: EbayMarketingCampaign[];
  adCampaigns?: EbayMarketingCampaign[];
  total?: number;
  limit?: number;
  offset?: number;
};

type EbayMarketingCampaign = {
  campaignId?: string;
  campaignName?: string;
  campaignStatus?: string;
  marketplaceId?: string;
  startDate?: string;
  endDate?: string;
  fundingStrategy?: {
    fundingModel?: string;
    adRateStrategy?: string;
    bidPercentage?: string | number | null;
  };
  bidPercentage?: string | number | null;
};

type EbayMarketingAdsResponse = {
  ads?: EbayMarketingAd[];
  total?: number;
  limit?: number;
  offset?: number;
};

type EbayMarketingAd = {
  listingId?: string | number;
  bidPercentage?: string | number | null;
};

export type EbayPromotedListingSyncRecord = {
  listingId: string;
  campaignId: string;
  campaignName: string;
  rateStrategy: EbayPromotedRateStrategy;
  bidPercentage: number | null;
};

export type EbayGeneralCampaignOption = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  marketplaceId: string;
  startDate: string | null;
  endDate: string | null;
  rateStrategy: EbayPromotedRateStrategy;
  bidPercentage: number | null;
  supported: boolean;
};

export type EbayPromotedAdWriteResult = {
  listingId: string;
  success: boolean;
  statusCode: number;
  adId: string | null;
  errorMessage: string | null;
};

function parseBidPercentage(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace("%", "").trim());

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizePromotedRateStrategy(value: unknown): EbayPromotedRateStrategy {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (normalized === "FIXED" || normalized === "DYNAMIC") {
    return normalized;
  }

  return "UNKNOWN";
}

async function fetchEbayMarketingJson<T>(
  storeNumber: 1 | 2 | 3,
  accessToken: string,
  url: URL,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const storeId = await waitForStoreEbayLimit(storeNumber, "BROWSE");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
  const responseText = await response.text();

  if (response.status === 429) {
    await recordStoreEbayBackoff(storeId, "BROWSE", `HTTP ${response.status}`);
  }

  if (!response.ok) {
    logger.error("ebay/fetchEbayMarketingJson", `Marketing API returned HTTP ${response.status}`, undefined, {
      storeNumber,
      url: url.pathname,
      responseBody: responseText.slice(0, 1000),
    });
    throw new Error(`eBay Marketing API request failed (${response.status}).`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    logger.error("ebay/fetchEbayMarketingJson", "Marketing API returned invalid JSON", undefined, {
      storeNumber,
      url: url.pathname,
      responseBody: responseText.slice(0, 500),
    });
    throw new Error("eBay Marketing API returned invalid JSON.");
  }
}

type EbayRestError = {
  message?: unknown;
  longMessage?: unknown;
  parameters?: Array<{ name?: unknown; value?: unknown }>;
};

type EbayBulkAdResponse = {
  responses?: Array<{
    listingId?: string | number;
    statusCode?: string | number;
    adId?: string;
    errors?: EbayRestError[];
  }>;
  errors?: EbayRestError[];
};

function formatEbayRestErrors(errors: EbayRestError[] | undefined) {
  const messages = (errors ?? []).flatMap((error) => [
    cleanEbayText(error.longMessage),
    cleanEbayText(error.message),
    ...(error.parameters ?? []).map((parameter) => cleanEbayText(parameter.value)),
  ]);

  return uniqueMessages(messages.filter(Boolean)).join("; ");
}

async function sendEbayMarketingRequest(
  storeNumber: 1 | 2 | 3,
  accessToken: string,
  url: URL,
  init: RequestInit,
) {
  const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const responseText = await response.text();

  if (response.status === 429) {
    await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
  }

  if (!response.ok) {
    let responseError = "";
    try {
      const payload = JSON.parse(responseText) as EbayBulkAdResponse;
      responseError = formatEbayRestErrors(payload.errors);
    } catch {
      responseError = cleanEbayText(responseText);
    }

    logger.error(
      "ebay/sendEbayMarketingRequest",
      `Marketing API returned HTTP ${response.status}`,
      undefined,
      {
        storeNumber,
        method: init.method ?? "GET",
        url: url.pathname,
        responseBody: responseText.slice(0, 1000),
      },
    );
    throw new Error(
      responseError || `eBay Marketing API request failed (${response.status}).`,
    );
  }

  return { response, responseText };
}

async function getEbayGeneralAdCampaigns(
  storeNumber: 1 | 2 | 3,
  accessToken: string,
  campaignStatus: string | null = "RUNNING",
) {
  const campaigns: EbayGeneralCampaignOption[] = [];
  const limit = 500;
  let offset = 0;

  while (true) {
    const url = new URL(`${EBAY_API_BASE_URL}/sell/marketing/v1/ad_campaign`);
    if (campaignStatus) {
      url.searchParams.set("campaign_status", campaignStatus);
    }
    url.searchParams.set("funding_strategy", "COST_PER_SALE");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const data = await fetchEbayMarketingJson<EbayMarketingCampaignResponse>(
      storeNumber,
      accessToken,
      url,
    );
    const pageCampaigns = data.campaigns ?? data.adCampaigns ?? [];

    for (const campaign of pageCampaigns) {
      const campaignId = String(campaign.campaignId ?? "").trim();
      if (!campaignId) {
        continue;
      }

      const fundingModel = String(
        campaign.fundingStrategy?.fundingModel ?? "",
      ).toUpperCase();
      if (fundingModel && fundingModel !== "COST_PER_SALE") {
        continue;
      }

      const declaredStrategy = normalizePromotedRateStrategy(
        campaign.fundingStrategy?.adRateStrategy,
      );
      const bidPercentage = parseBidPercentage(
        campaign.fundingStrategy?.bidPercentage ?? campaign.bidPercentage,
      );

      campaigns.push({
        campaignId,
        campaignName: String(campaign.campaignName ?? campaignId).trim(),
        campaignStatus: String(campaign.campaignStatus ?? "UNKNOWN").toUpperCase(),
        marketplaceId: String(campaign.marketplaceId ?? "EBAY_AU").toUpperCase(),
        startDate:
          typeof campaign.startDate === "string" ? campaign.startDate : null,
        endDate: typeof campaign.endDate === "string" ? campaign.endDate : null,
        rateStrategy:
          declaredStrategy === "UNKNOWN" && bidPercentage !== null
            ? "FIXED"
            : declaredStrategy,
        bidPercentage,
        supported:
          (declaredStrategy === "FIXED" ||
            (declaredStrategy === "UNKNOWN" && bidPercentage !== null)) &&
          ["RUNNING", "SCHEDULED", "PENDING"].includes(
            String(campaign.campaignStatus ?? "").toUpperCase(),
          ),
      });
    }

    const total = typeof data.total === "number" ? data.total : null;
    offset += pageCampaigns.length;

    if (pageCampaigns.length < limit || (total !== null && offset >= total)) {
      break;
    }
  }

  return campaigns;
}

export async function getEbayGeneralCampaignOptions(
  storeNumber: 1 | 2 | 3,
) {
  const accessToken = await getOAuthAccessToken(storeNumber);
  return getEbayGeneralAdCampaigns(storeNumber, accessToken, null);
}

export async function getEbayPromotedListingsEligibility(
  storeNumber: 1 | 2 | 3,
) {
  const accessToken = await getOAuthAccessToken(storeNumber);
  const url = new URL(
    `${EBAY_API_BASE_URL}/sell/account/v1/advertising_eligibility`,
  );
  url.searchParams.set("program_types", "PROMOTED_LISTINGS_STANDARD");
  const data = await fetchEbayMarketingJson<{
    advertisingEligibility?: Array<{
      programType?: string;
      status?: string;
      reason?: string;
    }>;
  }>(storeNumber, accessToken, url, {
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU",
  });
  const eligibility = data.advertisingEligibility?.find(
    (entry) => entry.programType === "PROMOTED_LISTINGS_STANDARD",
  );

  return {
    eligible: eligibility?.status === "ELIGIBLE",
    status: eligibility?.status ?? "UNKNOWN",
    reason: eligibility?.reason ?? null,
  };
}

async function getEbayAdsForCampaign(
  storeNumber: 1 | 2 | 3,
  accessToken: string,
  campaign: {
    campaignId: string;
    campaignName: string;
    rateStrategy: EbayPromotedRateStrategy;
    bidPercentage: number | null;
  },
) {
  const ads: EbayPromotedListingSyncRecord[] = [];
  const limit = 500;
  let offset = 0;

  while (true) {
    const url = new URL(
      `${EBAY_API_BASE_URL}/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaign.campaignId)}/ad`,
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const data = await fetchEbayMarketingJson<EbayMarketingAdsResponse>(
      storeNumber,
      accessToken,
      url,
    );
    const pageAds = data.ads ?? [];

    for (const ad of pageAds) {
      const listingId = String(ad.listingId ?? "").trim();
      if (!listingId) {
        continue;
      }

      const adBidPercentage = parseBidPercentage(ad.bidPercentage);
      const fixedBidPercentage =
        campaign.rateStrategy === "FIXED"
          ? adBidPercentage ?? campaign.bidPercentage
          : null;

      ads.push({
        listingId,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        rateStrategy: campaign.rateStrategy,
        bidPercentage: fixedBidPercentage,
      });
    }

    const total = typeof data.total === "number" ? data.total : null;
    offset += pageAds.length;

    if (pageAds.length < limit || (total !== null && offset >= total)) {
      break;
    }
  }

  return ads;
}

function shouldReplacePromotedRecord(
  current: EbayPromotedListingSyncRecord | undefined,
  next: EbayPromotedListingSyncRecord,
) {
  if (!current) {
    return true;
  }

  if (current.rateStrategy !== "FIXED" && next.rateStrategy === "FIXED") {
    return true;
  }

  if (
    current.rateStrategy === next.rateStrategy &&
    (next.bidPercentage ?? 0) > (current.bidPercentage ?? 0)
  ) {
    return true;
  }

  return false;
}

export async function getEbayPromotedListingSync(
  storeNumber: 1 | 2 | 3,
): Promise<Map<string, EbayPromotedListingSyncRecord>> {
  const accessToken = await getOAuthAccessToken(storeNumber);
  const campaigns = await getEbayGeneralAdCampaigns(storeNumber, accessToken);
  const promotedByListingId = new Map<string, EbayPromotedListingSyncRecord>();

  for (const campaign of campaigns) {
    const ads = await getEbayAdsForCampaign(storeNumber, accessToken, campaign);

    for (const ad of ads) {
      const current = promotedByListingId.get(ad.listingId);
      if (shouldReplacePromotedRecord(current, ad)) {
        promotedByListingId.set(ad.listingId, ad);
      }
    }
  }

  logger.info("ebay/getEbayPromotedListingSync", "Promoted listings synced from eBay", {
    storeNumber,
    campaignCount: campaigns.length,
    listingCount: promotedByListingId.size,
  });

  return promotedByListingId;
}

function normalizeBulkAdResults(
  requestedListingIds: string[],
  payload: EbayBulkAdResponse,
) {
  const responseByListingId = new Map(
    (payload.responses ?? []).map((response) => [
      String(response.listingId ?? "").trim(),
      response,
    ]),
  );

  return requestedListingIds.map<EbayPromotedAdWriteResult>((listingId) => {
    const response = responseByListingId.get(listingId);
    const statusCode = Number(response?.statusCode ?? 0);
    const errorMessage = formatEbayRestErrors(response?.errors);
    const success = statusCode >= 200 && statusCode < 300 && !errorMessage;

    return {
      listingId,
      success,
      statusCode,
      adId: response?.adId ? String(response.adId) : null,
      errorMessage:
        errorMessage ||
        (success ? null : "eBay did not confirm the promoted listing change."),
    };
  });
}

async function callEbayBulkAdAction(
  storeNumber: 1 | 2 | 3,
  campaignId: string,
  action:
    | "bulk_create_ads_by_listing_id"
    | "bulk_update_ads_bid_by_listing_id"
    | "bulk_delete_ads_by_listing_id",
  requests: Array<{ listingId: string; bidPercentage?: string }>,
) {
  const accessToken = await getOAuthAccessToken(storeNumber);
  const results: EbayPromotedAdWriteResult[] = [];

  for (let index = 0; index < requests.length; index += 500) {
    const requestChunk = requests.slice(index, index + 500);
    const url = new URL(
      `${EBAY_API_BASE_URL}/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/${action}`,
    );
    const { responseText } = await sendEbayMarketingRequest(
      storeNumber,
      accessToken,
      url,
      {
        method: "POST",
        body: JSON.stringify({ requests: requestChunk }),
      },
    );
    const payload = responseText
      ? (JSON.parse(responseText) as EbayBulkAdResponse)
      : { responses: [] };
    results.push(
      ...normalizeBulkAdResults(
        requestChunk.map((request) => request.listingId),
        payload,
      ),
    );
  }

  return results;
}

export async function createEbayGeneralCampaign(
  storeNumber: 1 | 2 | 3,
  input: { campaignName: string; bidPercentage: number },
) {
  const accessToken = await getOAuthAccessToken(storeNumber);
  const url = new URL(`${EBAY_API_BASE_URL}/sell/marketing/v1/ad_campaign`);
  const startDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { response } = await sendEbayMarketingRequest(
    storeNumber,
    accessToken,
    url,
    {
      method: "POST",
      body: JSON.stringify({
        campaignName: input.campaignName,
        startDate,
        marketplaceId: "EBAY_AU",
        fundingStrategy: {
          fundingModel: "COST_PER_SALE",
          adRateStrategy: "FIXED",
          bidPercentage: input.bidPercentage.toFixed(1),
        },
      }),
    },
  );
  const location = response.headers.get("location") ?? "";
  const campaignId = decodeURIComponent(
    location.split("/").filter(Boolean).at(-1) ?? "",
  ).trim();

  if (!campaignId) {
    throw new Error("eBay created the campaign but did not return its campaign ID.");
  }

  return {
    campaignId,
    campaignName: input.campaignName,
    campaignStatus: "SCHEDULED",
    bidPercentage: input.bidPercentage,
    startDate,
  };
}

export function createEbayPromotedAds(
  storeNumber: 1 | 2 | 3,
  campaignId: string,
  listingIds: string[],
  bidPercentage: number,
) {
  return callEbayBulkAdAction(
    storeNumber,
    campaignId,
    "bulk_create_ads_by_listing_id",
    listingIds.map((listingId) => ({
      listingId,
      bidPercentage: bidPercentage.toFixed(1),
    })),
  );
}

export function updateEbayPromotedAdRates(
  storeNumber: 1 | 2 | 3,
  campaignId: string,
  listingIds: string[],
  bidPercentage: number,
) {
  return callEbayBulkAdAction(
    storeNumber,
    campaignId,
    "bulk_update_ads_bid_by_listing_id",
    listingIds.map((listingId) => ({
      listingId,
      bidPercentage: bidPercentage.toFixed(1),
    })),
  );
}

export function deleteEbayPromotedAds(
  storeNumber: 1 | 2 | 3,
  campaignId: string,
  listingIds: string[],
) {
  return callEbayBulkAdAction(
    storeNumber,
    campaignId,
    "bulk_delete_ads_by_listing_id",
    listingIds.map((listingId) => ({ listingId })),
  );
}

/**
 * Sends an AddItem XML request to the eBay Trading API and parses the response.
 */
export async function callEbayAddItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; itemId?: string; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  // Exchange refresh token for a short-lived OAuth access token
  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "AddItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse("ebay/callEbayAddItem", "Raw eBay AddItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const addItemResponse = parsed.AddItemResponse;
    if (!addItemResponse) {
      return {
        success: false,
        errorMessage: "Invalid response from eBay API",
      };
    }

    const ack = addItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      const itemId = addItemResponse.ItemID?.toString();
      return { success: true, itemId };
    }

    const errorMessage = formatEbayApiErrors(
      addItemResponse.Errors,
      addItemResponse.Message,
    );
    await recordStoreEbayBackoff(storeId, "TRADING", errorMessage);

    return {
      success: false,
      errorMessage,
    };
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends an EndItem XML request to the eBay Trading API to end an active listing.
 */
export async function callEbayEndItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "EndItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse("ebay/callEbayEndItem", "Raw eBay EndItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const endItemResponse = parsed.EndItemResponse;
    if (!endItemResponse) {
      return { success: false, errorMessage: "Invalid response from eBay API" };
    }

    const ack = endItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      return { success: true };
    }

    const errorMessage = formatEbayApiErrors(
      endItemResponse.Errors,
      endItemResponse.Message,
    );
    await recordStoreEbayBackoff(storeId, "TRADING", errorMessage);

    return {
      success: false,
      errorMessage,
    };
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends a ReviseItem XML request to the eBay Trading API to update a live listing.
 */
export async function callEbayReviseItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "ReviseItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse("ebay/callEbayReviseItem", "Raw eBay ReviseItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const reviseItemResponse = parsed.ReviseItemResponse;
    if (!reviseItemResponse) {
      return { success: false, errorMessage: "Invalid response from eBay API" };
    }

    const ack = reviseItemResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      return { success: true };
    }

    const errorMessage = formatEbayApiErrors(
      reviseItemResponse.Errors,
      reviseItemResponse.Message,
    );
    await recordStoreEbayBackoff(storeId, "TRADING", errorMessage);

    return {
      success: false,
      errorMessage,
    };
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends a ReviseInventoryStatus XML request to update price and/or quantity.
 * This avoids full-listing validation for unrelated fields such as photos.
 */
export async function callEbayReviseInventoryStatus(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<{ success: boolean; errorMessage?: string }> {
  const creds = getStoreCredentials(storeNumber);

  let accessToken: string;
  try {
    accessToken = await getOAuthAccessToken(storeNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return { success: false, errorMessage: message };
  }

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "ReviseInventoryStatus",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse(
      "ebay/callEbayReviseInventoryStatus",
      "Raw eBay ReviseInventoryStatus response received",
      xmlText,
      {
        storeNumber,
        httpStatus: response.status,
      }
    );

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });
    const parsed = parser.parse(xmlText);

    const reviseInventoryStatusResponse = parsed.ReviseInventoryStatusResponse;
    if (!reviseInventoryStatusResponse) {
      return { success: false, errorMessage: "Invalid response from eBay API" };
    }

    const ack = reviseInventoryStatusResponse.Ack;

    if (ack === "Success" || ack === "Warning") {
      return { success: true };
    }

    const errorMessage = formatEbayApiErrors(
      reviseInventoryStatusResponse.Errors,
      reviseInventoryStatusResponse.Message,
    );
    await recordStoreEbayBackoff(storeId, "TRADING", errorMessage);

    return {
      success: false,
      errorMessage,
    };
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, errorMessage: message };
  }
}

/**
 * Sends a GetSellerList XML request to the eBay Trading API.
 * Returns raw XML because import-specific parsing lives in lib/ebay-import.ts.
 */
export async function callEbayGetSellerList(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<string> {
  const creds = getStoreCredentials(storeNumber);
  const accessToken = await getOAuthAccessToken(storeNumber);

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "GetSellerList",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse("ebay/callEbayGetSellerList", "Raw eBay GetSellerList response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    if (!response.ok) {
      throw new Error(`eBay GetSellerList failed with HTTP ${response.status}: ${xmlText}`);
    }

    return xmlText;
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    logger.error("ebay/callEbayGetSellerList", "GetSellerList request failed", err, {
      storeNumber,
    });
    throw err;
  }
}

export async function callEbayGetItem(
  xmlBody: string,
  storeNumber: 1 | 2 | 3
): Promise<string> {
  const creds = getStoreCredentials(storeNumber);
  const accessToken = await getOAuthAccessToken(storeNumber);

  try {
    const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
    const response = await fetch(EBAY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "X-EBAY-API-SITEID": "15",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-APP-NAME": creds.appId,
        "X-EBAY-API-DEV-NAME": creds.devId,
        "X-EBAY-API-CERT-NAME": creds.certId,
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
      body: xmlBody,
    });

    const xmlText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
    }

    logger.ebayResponse("ebay/callEbayGetItem", "Raw eBay GetItem response received", xmlText, {
      storeNumber,
      httpStatus: response.status,
    });

    if (!response.ok) {
      throw new Error(`eBay GetItem failed with HTTP ${response.status}: ${xmlText}`);
    }

    return xmlText;
  } catch (err) {
    await recordStoreEbayBackoff(await getStoreIdForStoreNumber(storeNumber), "TRADING", err);
    logger.error("ebay/callEbayGetItem", "GetItem request failed", err, {
      storeNumber,
    });
    throw err;
  }
}

/**
 * Fetches the seller's Business Policies (shipping, returns, payment) from eBay.
 */
export async function getEbayBusinessPolicies(storeNumber: 1 | 2 | 3): Promise<{
  shipping: Array<{ profileId: string; profileName: string }>;
  returns: Array<{ profileId: string; profileName: string }>;
  payment: Array<{ profileId: string; profileName: string }>;
}> {
  const creds = getStoreCredentials(storeNumber);
  const accessToken = await getOAuthAccessToken(storeNumber);

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ShowSellerProfilePreferences>true</ShowSellerProfilePreferences>
</GetUserPreferencesRequest>`;

  const storeId = await waitForStoreEbayLimit(storeNumber, "TRADING");
  const response = await fetch(EBAY_API_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-SITEID": "15",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-CALL-NAME": "GetUserPreferences",
      "X-EBAY-API-APP-NAME": creds.appId,
      "X-EBAY-API-DEV-NAME": creds.devId,
      "X-EBAY-API-CERT-NAME": creds.certId,
      "Content-Type": "text/xml",
      "X-EBAY-API-IAF-TOKEN": accessToken,
      Authorization: `Bearer ${accessToken}`,
    },
    body: xmlBody,
  });

  const xmlText = await response.text();

  if (response.status === 429) {
    await recordStoreEbayBackoff(storeId, "TRADING", `HTTP ${response.status}`);
  }

  logger.ebayResponse("ebay/getEbayBusinessPolicies", "GetUserPreferences response", xmlText, {
    storeNumber,
    httpStatus: response.status,
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });
  const parsed = parser.parse(xmlText);

  const prefs = parsed.GetUserPreferencesResponse;
  if (!prefs) {
    throw new Error("Invalid GetUserPreferences response from eBay");
  }

  const shipping: Array<{ profileId: string; profileName: string }> = [];
  const returns: Array<{ profileId: string; profileName: string }> = [];
  const payment: Array<{ profileId: string; profileName: string }> = [];

  const sellerProfilePrefs = prefs.SellerProfilePreferences;
  if (!sellerProfilePrefs) {
    return { shipping, returns, payment };
  }

  let profiles = sellerProfilePrefs.SupportedSellerProfiles?.SupportedSellerProfile;
  if (!profiles) {
    return { shipping, returns, payment };
  }

  // Ensure it's always an array
  if (!Array.isArray(profiles)) {
    profiles = [profiles];
  }

  for (const profile of profiles) {
    const entry = {
      profileId: String(profile.ProfileID ?? ""),
      profileName: String(profile.ProfileName ?? ""),
    };

    const profileType = String(profile.ProfileType ?? "");

    if (profileType === "SHIPPING") {
      shipping.push(entry);
    } else if (profileType === "RETURN_POLICY") {
      returns.push(entry);
    } else if (profileType === "PAYMENT") {
      payment.push(entry);
    }
  }

  return { shipping, returns, payment };
}

/**
 * Calls the eBay Taxonomy REST API to find suggested categories for a product title.
 * Uses the modern /commerce/taxonomy/v1 endpoint instead of the legacy Trading API
 * (which returns 503 from Akamai CDN).
 *
 * category_tree_id 15 = eBay Australia.
 * Returns up to 5 suggestions. Never throws — returns an empty array on failure.
 */
export async function getEbaySuggestedCategories(
  title: string,
  storeNumber: 1 | 2 | 3
): Promise<Array<{ categoryId: string; categoryName: string }>> {
  try {
    // Truncate long titles at a word boundary (max 80 chars)
    let query = title.trim();
    if (query.length > 80) {
      const shortened = query.slice(0, 80);
      const lastSpace = shortened.lastIndexOf(" ");
      query = lastSpace > 20 ? shortened.slice(0, lastSpace) : shortened;
    }

    const accessToken = await getOAuthAccessToken(storeNumber);

    // eBay Australia category_tree_id = 15
    const taxonomyUrl = `${EBAY_API_BASE_URL}/commerce/taxonomy/v1/category_tree/15/get_category_suggestions?q=${encodeURIComponent(query)}`;

    const storeId = await waitForStoreEbayLimit(storeNumber, "BROWSE");
    const response = await fetch(taxonomyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const responseText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "BROWSE", `HTTP ${response.status}`);
    }

    logger.info("ebay/getEbaySuggestedCategories", "Taxonomy API response received", {
      storeNumber,
      httpStatus: response.status,
      queryLength: query.length,
      titleQuery: query.slice(0, 60),
    });

    if (!response.ok) {
      logger.error("ebay/getEbaySuggestedCategories", `Taxonomy API returned HTTP ${response.status}`, undefined, {
        storeNumber,
        responseBody: responseText.slice(0, 500),
      });
      return [];
    }

    const data = JSON.parse(responseText) as {
      categorySuggestions?: Array<{
        category: { categoryId: string; categoryName: string };
        categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
      }>;
    };

    let suggestionsToUse = data.categorySuggestions ?? [];

    if (suggestionsToUse.length === 0) {
      // 1. Clean the query to remove compatibility clauses, commas, dashes, and other noise
      let cleanQuery = title
        .split(/[,|\-|—–]|(\sfits\s)|(\sfor\s)|(\scompatible\s)/i)[0]
        .trim();

      // If cleanQuery is too short or unchanged, take the first 5 words
      if (cleanQuery.length < 10 || cleanQuery === query) {
        cleanQuery = title.split(/\s+/).slice(0, 5).join(" ");
      }

      if (cleanQuery && cleanQuery !== query) {
        logger.info("ebay/getEbaySuggestedCategories", "Retrying category suggestions with fallback query", {
          originalQuery: query,
          fallbackQuery: cleanQuery,
        });

        const fallbackUrl = `${EBAY_API_BASE_URL}/commerce/taxonomy/v1/category_tree/15/get_category_suggestions?q=${encodeURIComponent(cleanQuery)}`;
        const fallbackRes = await fetch(fallbackUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        if (fallbackRes.ok) {
          const fallbackText = await fallbackRes.text();
          const fallbackData = JSON.parse(fallbackText) as {
            categorySuggestions?: typeof data.categorySuggestions;
          };
          if (fallbackData.categorySuggestions && fallbackData.categorySuggestions.length > 0) {
            suggestionsToUse = fallbackData.categorySuggestions;
          }
        }
      }
    }

    if (suggestionsToUse.length === 0) {
      logger.info("ebay/getEbaySuggestedCategories", "No category suggestions returned after fallback retries", {
        storeNumber,
        query: query.slice(0, 60),
      });
      return [];
    }

    // Map and deduplicate categories
    const seen = new Set<string>();
    const mapped: Array<{ categoryId: string; categoryName: string }> = [];

    for (const suggestion of suggestionsToUse) {
      const id = suggestion.category.categoryId;
      if (seen.has(id)) continue;
      seen.add(id);

      // Build a full path like "Electronics > Tablets & eReaders"
      const ancestors = suggestion.categoryTreeNodeAncestors || [];
      const pathParts = ancestors.map((a) => a.categoryName).reverse();
      pathParts.push(suggestion.category.categoryName);
      const fullPath = pathParts.length > 1 ? pathParts.join(" > ") : suggestion.category.categoryName;

      mapped.push({
        categoryId: id,
        categoryName: fullPath,
      });

      if (mapped.length >= 5) break;
    }

    logger.info("ebay/getEbaySuggestedCategories", "Category suggestions mapped", {
      storeNumber,
      count: mapped.length,
      topCategory: mapped[0]?.categoryName,
    });

    return mapped;
  } catch (err) {
    logger.error("ebay/getEbaySuggestedCategories", "Failed to get suggested categories", err, {
      storeNumber,
      title: title.slice(0, 60),
    });
    return [];
  }
}

export type EbayCategoryAspect = {
  name: string;
  required: boolean;
  values: string[];
  inputType: string | null;
};

/**
 * Fetches eBay AU category aspect metadata for a leaf category.
 * category_tree_id 15 = eBay Australia.
 */
export async function getEbayCategoryAspects(
  categoryId: string,
  storeNumber: 1 | 2 | 3
): Promise<EbayCategoryAspect[]> {
  const normalizedCategoryId = categoryId.trim();
  if (!/^\d+$/.test(normalizedCategoryId)) {
    return [];
  }

  try {
    const accessToken = await getOAuthAccessToken(storeNumber);
    const url =
      `${EBAY_API_BASE_URL}/commerce/taxonomy/v1/category_tree/15` +
      `/get_item_aspects_for_category?category_id=${encodeURIComponent(normalizedCategoryId)}`;

    const storeId = await waitForStoreEbayLimit(storeNumber, "BROWSE");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    const responseText = await response.text();

    if (response.status === 429) {
      await recordStoreEbayBackoff(storeId, "BROWSE", `HTTP ${response.status}`);
    }

    if (!response.ok) {
      logger.warn("ebay/getEbayCategoryAspects", "Taxonomy aspects request failed", {
        storeNumber,
        categoryId: normalizedCategoryId,
        httpStatus: response.status,
        responseBody: responseText.slice(0, 500),
      });
      return [];
    }

    const data = JSON.parse(responseText) as {
      aspects?: Array<{
        localizedAspectName?: string;
        aspectConstraint?: {
          aspectRequired?: boolean;
          aspectMode?: string;
          aspectDataType?: string;
        };
        aspectValues?: Array<{ localizedValue?: string }>;
      }>;
    };

    return (data.aspects ?? [])
      .map((aspect) => ({
        name: String(aspect.localizedAspectName ?? "").trim(),
        required: aspect.aspectConstraint?.aspectRequired === true,
        values: (aspect.aspectValues ?? [])
          .map((value) => String(value.localizedValue ?? "").trim())
          .filter(Boolean),
        inputType:
          aspect.aspectConstraint?.aspectMode ??
          aspect.aspectConstraint?.aspectDataType ??
          null,
      }))
      .filter((aspect) => aspect.name);
  } catch (error) {
    logger.warn("ebay/getEbayCategoryAspects", "Failed to fetch category aspects", {
      storeNumber,
      categoryId: normalizedCategoryId,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}
