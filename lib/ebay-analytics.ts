import "server-only";

import {
  EBAY_API_BASE_URL,
  getStoreCredentials,
} from "@/lib/ebay";
import {
  recordEbayRateLimitBackoff,
  waitForEbayRateLimit,
} from "@/lib/ebay-rate-limit";
import { logger } from "@/lib/logger";

export const EBAY_ANALYTICS_BATCH_SIZE = 200;
export const EBAY_ANALYTICS_VIEWS_METRIC = "LISTING_VIEWS_TOTAL";
const ANALYTICS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly";
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 7_200;
const ANALYTICS_REQUEST_TIMEOUT_MS = 30_000;

type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<1 | 2 | 3, CachedToken>();
const pendingTokens = new Map<1 | 2 | 3, Promise<CachedToken>>();

type EbayAnalyticsValue = {
  value?: unknown;
  applicable?: unknown;
};

export type EbayTrafficReport = {
  startDate?: unknown;
  endDate?: unknown;
  lastUpdatedDate?: unknown;
  header?: {
    dimensionKeys?: Array<{ key?: unknown }>;
    metrics?: Array<{ key?: unknown }>;
  };
  records?: Array<{
    dimensionValues?: EbayAnalyticsValue[];
    metricValues?: EbayAnalyticsValue[];
  }>;
  errors?: Array<{ errorId?: unknown; message?: unknown; longMessage?: unknown }>;
  warnings?: Array<{ errorId?: unknown; message?: unknown; longMessage?: unknown }>;
};

export type EbayListingViewsBatchResult = {
  viewsByListingId: Map<string, number>;
  startDate: string | null;
  endDate: string | null;
  lastUpdatedDate: string | null;
  warnings: string[];
};

export type EbayListingViewsResult = EbayListingViewsBatchResult & {
  requestedListings: number;
  successfulBatches: number;
  failedBatches: number;
  authorizationRequired: boolean;
  errors: string[];
};

export class EbayAnalyticsAuthorizationError extends Error {
  constructor(message = "eBay Analytics authorization is required for this store.") {
    super(message);
    this.name = "EbayAnalyticsAuthorizationError";
  }
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeAnalyticsError(status: number, body: EbayTrafficReport) {
  const messages = (body.errors ?? [])
    .map((error) => cleanString(error.longMessage) ?? cleanString(error.message))
    .filter((value): value is string => Boolean(value));
  return messages.length > 0
    ? messages.join("; ")
    : `eBay Analytics request failed (HTTP ${status}).`;
}

function getLosAngelesDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function formatCompactDate(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function getEbayAnalyticsDateRange(now = new Date()) {
  const { year, month, day } = getLosAngelesDateParts(now);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    start: formatCompactDate(start),
    end: formatCompactDate(end),
  };
}

export function chunkEbayListingIds(listingIds: string[]) {
  const unique = Array.from(
    new Set(listingIds.map((value) => value.trim()).filter(Boolean)),
  );
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += EBAY_ANALYTICS_BATCH_SIZE) {
    chunks.push(unique.slice(index, index + EBAY_ANALYTICS_BATCH_SIZE));
  }
  return chunks;
}

export function parseEbayTrafficReport(
  report: EbayTrafficReport,
): EbayListingViewsBatchResult {
  const dimensionIndex =
    report.header?.dimensionKeys?.findIndex(
      (dimension) => cleanString(dimension.key) === "LISTING_ID",
    ) ?? -1;
  const metricIndex =
    report.header?.metrics?.findIndex(
      (metric) => cleanString(metric.key) === EBAY_ANALYTICS_VIEWS_METRIC,
    ) ?? -1;

  if (dimensionIndex < 0 || metricIndex < 0) {
    throw new Error("eBay Analytics response omitted listing or views metadata.");
  }

  const viewsByListingId = new Map<string, number>();
  for (const record of report.records ?? []) {
    const listingValue = record.dimensionValues?.[dimensionIndex];
    const metricValue = record.metricValues?.[metricIndex];
    const listingId = cleanString(listingValue?.value);
    if (!listingId || listingValue?.applicable === false || metricValue?.applicable === false) {
      continue;
    }

    const rawCount = metricValue?.value;
    if (
      (typeof rawCount !== "number" && typeof rawCount !== "string") ||
      (typeof rawCount === "string" && !rawCount.trim())
    ) {
      continue;
    }
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 0) {
      continue;
    }
    viewsByListingId.set(listingId, count);
  }

  return {
    viewsByListingId,
    startDate: cleanString(report.startDate),
    endDate: cleanString(report.endDate),
    lastUpdatedDate: cleanString(report.lastUpdatedDate),
    warnings: (report.warnings ?? [])
      .map((warning) => cleanString(warning.longMessage) ?? cleanString(warning.message))
      .filter((value): value is string => Boolean(value)),
  };
}

async function exchangeAnalyticsToken(storeNumber: 1 | 2 | 3) {
  const credentials = getStoreCredentials(storeNumber);
  if (!credentials.refreshToken) {
    throw new EbayAnalyticsAuthorizationError(
      `No eBay refresh token is configured for Store ${storeNumber}.`,
    );
  }
  if (!credentials.appId || !credentials.certId) {
    throw new EbayAnalyticsAuthorizationError(
      "eBay application credentials are not configured.",
    );
  }

  const response = await fetch(`${EBAY_API_BASE_URL}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${credentials.appId}:${credentials.certId}`,
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      scope: ANALYTICS_SCOPE,
    }).toString(),
    signal: AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    logger.warn("ebay/analytics-auth", "eBay Analytics token exchange failed", {
      storeNumber,
      status: response.status,
      error: body.error ?? null,
    });
    throw new EbayAnalyticsAuthorizationError(
      body.error_description || "eBay Analytics permission is unavailable for this store.",
    );
  }

  const lifetime =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + lifetime * 1_000,
  };
}

async function getAnalyticsToken(storeNumber: 1 | 2 | 3) {
  const cached = tokenCache.get(storeNumber);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }
  const pending = pendingTokens.get(storeNumber);
  if (pending) return (await pending).accessToken;

  const request = exchangeAnalyticsToken(storeNumber);
  pendingTokens.set(storeNumber, request);
  try {
    const token = await request;
    tokenCache.set(storeNumber, token);
    return token.accessToken;
  } finally {
    if (pendingTokens.get(storeNumber) === request) pendingTokens.delete(storeNumber);
  }
}

async function fetchViewsBatch(input: {
  storeId: string;
  storeNumber: 1 | 2 | 3;
  listingIds: string[];
  dateRange: { start: string; end: string };
}) {
  await waitForEbayRateLimit(input.storeId, "ANALYTICS");
  const token = await getAnalyticsToken(input.storeNumber);
  const url = new URL(`${EBAY_API_BASE_URL}/sell/analytics/v1/traffic_report`);
  url.search = new URLSearchParams({
    dimension: "LISTING",
    metric: EBAY_ANALYTICS_VIEWS_METRIC,
    filter: `listing_ids:{${input.listingIds.join("|")}},date_range:[${input.dateRange.start}..${input.dateRange.end}]`,
  }).toString();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as EbayTrafficReport;
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(input.storeNumber);
    throw new EbayAnalyticsAuthorizationError();
  }
  if (response.status === 429) {
    await recordEbayRateLimitBackoff(input.storeId, "ANALYTICS", "HTTP 429");
  }
  if (!response.ok) throw new Error(safeAnalyticsError(response.status, body));
  return parseEbayTrafficReport(body);
}

export async function fetchEbayListingViews(input: {
  storeId: string;
  storeNumber: 1 | 2 | 3;
  listingIds: string[];
  now?: Date;
}, options: {
  fetchBatch?: (
    listingIds: string[],
    dateRange: { start: string; end: string },
  ) => Promise<EbayListingViewsBatchResult>;
} = {}): Promise<EbayListingViewsResult> {
  const batches = chunkEbayListingIds(input.listingIds);
  const dateRange = getEbayAnalyticsDateRange(input.now);
  const result: EbayListingViewsResult = {
    viewsByListingId: new Map(),
    requestedListings: batches.reduce((total, batch) => total + batch.length, 0),
    successfulBatches: 0,
    failedBatches: 0,
    authorizationRequired: false,
    errors: [],
    warnings: [],
    startDate: null,
    endDate: null,
    lastUpdatedDate: null,
  };

  for (const listingIds of batches) {
    try {
      const batch = options.fetchBatch
        ? await options.fetchBatch(listingIds, dateRange)
        : await fetchViewsBatch({ ...input, listingIds, dateRange });
      result.successfulBatches += 1;
      for (const [listingId, count] of batch.viewsByListingId) {
        result.viewsByListingId.set(listingId, count);
      }
      result.warnings.push(...batch.warnings);
      result.startDate = batch.startDate ?? result.startDate;
      result.endDate = batch.endDate ?? result.endDate;
      result.lastUpdatedDate = batch.lastUpdatedDate ?? result.lastUpdatedDate;
    } catch (error) {
      result.failedBatches += 1;
      if (error instanceof EbayAnalyticsAuthorizationError) {
        result.authorizationRequired = true;
      }
      result.errors.push(error instanceof Error ? error.message : String(error));
      if (result.authorizationRequired) break;
    }
  }

  return result;
}
