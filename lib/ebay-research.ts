import "server-only";

import {
  EbayResearchBatchStatus,
  EbayResearchConditionFilter,
  EbayResearchJobStatus,
  EbayResearchMode,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { EBAY_API_BASE_URL, getOAuthAccessToken, getStoreNumber } from "@/lib/ebay";
import {
  recordEbayRateLimitBackoff,
  waitForEbayRateLimit,
} from "@/lib/ebay-rate-limit";
import {
  assertNoEbayLaneStartConflict,
  getEbayReadLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { launchScraperBrowser } from "@/lib/scraper-browser";

const VALID_LIMITS = [10, 30] as const;
const DEFAULT_RESEARCH_LIMIT = 30;
const DEFAULT_POSTCODE = "2217";
const ACTIVE_SEARCH_CACHE_TTL_MS = 45 * 60 * 1000;
const ACTIVE_SEARCH_CACHE_VERSION = "v3";
const RESEARCH_BATCH_COOLDOWN_MS = 30 * 1000;
const RESEARCH_RETENTION_MS = 2 * 60 * 60 * 1000;
const RESEARCH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BATCH_QUERIES = 5;
const TERMINAL_RESEARCH_JOB_STATUSES: EbayResearchJobStatus[] = [
  EbayResearchJobStatus.COMPLETED,
  EbayResearchJobStatus.PARTIAL,
  EbayResearchJobStatus.FAILED,
];
const TERMINAL_RESEARCH_BATCH_STATUSES: EbayResearchBatchStatus[] = [
  EbayResearchBatchStatus.COMPLETED,
  EbayResearchBatchStatus.PARTIAL,
  EbayResearchBatchStatus.FAILED,
];

type EbayResearchJobRecord = {
  id: string;
  userId: string;
  storeId: string;
  batchId: string | null;
  status: EbayResearchJobStatus;
  mode: EbayResearchMode;
  conditionFilter: EbayResearchConditionFilter;
  query: string;
  limit: number;
  activeCount: number;
  soldCount: number;
  activeSummary: Prisma.JsonValue;
  soldSummary: Prisma.JsonValue;
  activeResults: Prisma.JsonValue;
  soldResults: Prisma.JsonValue;
  warningMessage: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  batch?: EbayResearchBatchRecord | null;
};

type EbayResearchBatchRecord = {
  id: string;
  userId: string;
  storeId: string;
  status: EbayResearchBatchStatus;
  total: number;
  completed: number;
  failed: number;
  cooldownUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  pausedAt: Date | null;
  expiresAt: Date | null;
  jobs?: EbayResearchJobRecord[];
};

export type EbayResearchResult = {
  source: "ACTIVE" | "SOLD";
  itemId: string | null;
  title: string;
  url: string;
  imageUrl: string | null;
  seller: string | null;
  condition: string | null;
  itemPrice: string;
  shippingPrice: string;
  landedPrice: string;
  currency: "AUD";
  location: string | null;
  listedAt?: string | null;
  soldAt?: string | null;
  matchScore?: number;
  soldQuantity?: number | null;
  soldCountText?: string | null;
};

type EbayResearchSummary = {
  count: number;
  lowestPrice: string | null;
  averageLowest10: string | null;
  medianPrice: string | null;
  totalSoldQuantity: number;
  generatedAt: string;
};

type EbayResearchPhase = "QUICK" | "REFINING" | "COMPLETE";

type SearchPlan = {
  primary: string;
  strict: string | null;
  tokens: string[];
  strongTokens: string[];
  tokenSet: Set<string>;
};

type QuerySetResult = {
  results: EbayResearchResult[];
  succeeded: boolean;
  errors: string[];
};

type CreateEbayResearchJobInput = {
  userId: string;
  storeId: string;
  query: unknown;
  mode: unknown;
  limit: unknown;
  conditionFilter?: unknown;
};

type CreateEbayResearchBatchInput = {
  userId: string;
  storeId: string;
  queries: unknown;
  limit: unknown;
  conditionFilter?: unknown;
};

const CONDITION_FILTER_IDS: Record<EbayResearchConditionFilter, number[]> = {
  [EbayResearchConditionFilter.ANY]: [],
  [EbayResearchConditionFilter.NEW]: [1000],
  [EbayResearchConditionFilter.USED]: [3000, 4000, 5000, 6000],
  [EbayResearchConditionFilter.NEW_OTHER]: [1500, 1750],
  [EbayResearchConditionFilter.REFURBISHED]: [
    2000,
    2010,
    2020,
    2030,
    2500,
    2750,
  ],
  [EbayResearchConditionFilter.PARTS_NOT_WORKING]: [7000],
};

const ACCESSORY_ONLY_SIGNALS = [
  "anti slip",
  "case",
  "cover",
  "covers",
  "grip cap",
  "joystick cap",
  "parts only",
  "pouch",
  "protector",
  "protective",
  "protective cover",
  "repair",
  "replacement shell",
  "screen protector",
  "shockproof",
  "silicone",
  "skin",
  "sleeve",
  "spares",
  "stand case",
  "thumbstick cap",
];

const globalForEbayResearchJobs = globalThis as typeof globalThis & {
  listflowEbayResearchJobIds?: Set<string>;
  listflowEbayResearchActiveCache?: Map<
    string,
    { expiresAt: number; results: EbayResearchResult[] }
  >;
  listflowEbayResearchCleanupAt?: Map<string, number>;
};

function getRunningJobIds() {
  if (!globalForEbayResearchJobs.listflowEbayResearchJobIds) {
    globalForEbayResearchJobs.listflowEbayResearchJobIds = new Set<string>();
  }

  return globalForEbayResearchJobs.listflowEbayResearchJobIds;
}

function getActiveSearchCache() {
  if (!globalForEbayResearchJobs.listflowEbayResearchActiveCache) {
    globalForEbayResearchJobs.listflowEbayResearchActiveCache = new Map();
  }

  return globalForEbayResearchJobs.listflowEbayResearchActiveCache;
}

function getCleanupCache() {
  if (!globalForEbayResearchJobs.listflowEbayResearchCleanupAt) {
    globalForEbayResearchJobs.listflowEbayResearchCleanupAt = new Map();
  }

  return globalForEbayResearchJobs.listflowEbayResearchCleanupAt;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected eBay research error";
}

function getResearchExpiresAt(completedAt: Date) {
  return new Date(completedAt.getTime() + RESEARCH_RETENTION_MS);
}

function getBrowseApiErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "eBay API authorization failed. Reconnect or refresh the eBay store credentials.";
  }

  if (status === 429) {
    return "eBay API rate limit reached. Wait a few minutes before searching again.";
  }

  return `eBay active search failed (${status}).`;
}

function asJsonResults(value: Prisma.JsonValue): EbayResearchResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is EbayResearchResult => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }

    const record = entry as Record<string, unknown>;
    return typeof record.title === "string" && typeof record.url === "string";
  });
}

function asJsonSummary(value: Prisma.JsonValue): EbayResearchSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildSummary([]);
  }

  const record = value as Record<string, unknown>;

  return {
    count: typeof record.count === "number" ? record.count : 0,
    lowestPrice:
      typeof record.lowestPrice === "string" ? record.lowestPrice : null,
    averageLowest10:
      typeof record.averageLowest10 === "string"
        ? record.averageLowest10
        : null,
    medianPrice:
      typeof record.medianPrice === "string" ? record.medianPrice : null,
    totalSoldQuantity:
      typeof record.totalSoldQuantity === "number"
        ? record.totalSoldQuantity
        : 0,
    generatedAt:
      typeof record.generatedAt === "string"
        ? record.generatedAt
        : new Date().toISOString(),
  };
}

function normalizeQuery(value: unknown) {
  const query = typeof value === "string" ? value.trim() : "";

  if (!query) {
    throw new Error("Search query is required.");
  }

  return query.length > 100 ? query.slice(0, 100).trim() : query;
}

function normalizeBatchQueries(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Batch queries must be an array.");
  }

  const seen = new Set<string>();
  const queries: string[] = [];

  for (const entry of value) {
    const query = normalizeQuery(entry);
    const key = query.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    queries.push(query);
  }

  if (queries.length === 0) {
    throw new Error("Enter at least one product name.");
  }

  if (queries.length > MAX_BATCH_QUERIES) {
    throw new Error(`Batch search supports up to ${MAX_BATCH_QUERIES} product names.`);
  }

  return queries;
}

function normalizeMode(value: unknown): EbayResearchMode {
  if (
    value === EbayResearchMode.ACTIVE ||
    value === EbayResearchMode.SOLD ||
    value === EbayResearchMode.BOTH
  ) {
    return value;
  }

  return EbayResearchMode.ACTIVE;
}

function normalizeConditionFilter(value: unknown): EbayResearchConditionFilter {
  if (
    value === EbayResearchConditionFilter.ANY ||
    value === EbayResearchConditionFilter.NEW ||
    value === EbayResearchConditionFilter.USED ||
    value === EbayResearchConditionFilter.NEW_OTHER ||
    value === EbayResearchConditionFilter.REFURBISHED ||
    value === EbayResearchConditionFilter.PARTS_NOT_WORKING
  ) {
    return value;
  }

  return EbayResearchConditionFilter.ANY;
}

function getConditionIds(filter: EbayResearchConditionFilter) {
  return CONDITION_FILTER_IDS[filter];
}

function getConditionFilterParam(filter: EbayResearchConditionFilter) {
  const ids = getConditionIds(filter);
  return ids.length > 0 ? ids.join("|") : null;
}

function normalizeLimit(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : DEFAULT_RESEARCH_LIMIT;
  const finite = Number.isFinite(parsed) ? parsed : DEFAULT_RESEARCH_LIMIT;

  if (finite <= 10) return 10;
  return 30;
}

function parsePrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/(\d+(?:\.\d{1,2})?)/);

  return match ? Number(match[1]) : 0;
}

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesPhrase(text: string, phrase: string) {
  return new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`).test(text);
}

function isAccessoryOnlyMismatch(title: string, plan: SearchPlan) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(plan.primary);
  const titleHasAccessorySignal = ACCESSORY_ONLY_SIGNALS.some((signal) =>
    textIncludesPhrase(normalizedTitle, signal)
  );

  if (!titleHasAccessorySignal) {
    return false;
  }

  const queryRequestsAccessory = ACCESSORY_ONLY_SIGNALS.some((signal) =>
    textIncludesPhrase(normalizedQuery, signal)
  );

  return !queryRequestsAccessory;
}

function conditionMatchesFilter(
  condition: string | null | undefined,
  filter: EbayResearchConditionFilter
) {
  if (filter === EbayResearchConditionFilter.ANY) {
    return true;
  }

  const normalized = normalizeSearchText(condition ?? "");

  if (!normalized) {
    return false;
  }

  if (filter === EbayResearchConditionFilter.NEW) {
    return (
      normalized.includes("brand new") ||
      normalized === "new" ||
      normalized.startsWith("new ")
    ) && !normalized.includes("other") &&
      !normalized.includes("open box") &&
      !normalized.includes("defect");
  }

  if (filter === EbayResearchConditionFilter.NEW_OTHER) {
    return (
      normalized.includes("new other") ||
      normalized.includes("open box") ||
      normalized.includes("new with defect")
    );
  }

  if (filter === EbayResearchConditionFilter.USED) {
    return (
      normalized.includes("used") ||
      normalized.includes("pre owned") ||
      normalized.includes("preowned")
    );
  }

  if (filter === EbayResearchConditionFilter.REFURBISHED) {
    return normalized.includes("refurbished") || normalized.includes("renewed");
  }

  return (
    normalized.includes("parts") ||
    normalized.includes("not working") ||
    normalized.includes("repair") ||
    normalized.includes("spares")
  );
}

function normalizeTitleKey(value: string) {
  return normalizeSearchText(value).split(" ").slice(0, 12).join(" ");
}

function buildSearchPlan(rawQuery: string): SearchPlan {
  const cleaned = rawQuery
    .replace(
      /\b(brand\s+new|free\s+(postage|shipping|delivery)|fast\s+(postage|shipping|delivery)|australia\s+stock|au\s+stock|local\s+stock|in\s+stock|buy\s+it\s+now|genuine|hot\s+sale)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  const primary = (cleaned || rawQuery).slice(0, 100).trim();
  const normalized = normalizeSearchText(primary);
  const weakTokens = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "new",
    "buy",
    "item",
    "product",
    "sale",
  ]);
  const tokens = normalized
    .split(" ")
    .filter(
      (token) => (token.length >= 2 || /^\d+$/.test(token)) && !weakTokens.has(token)
    );
  const strongTokens = tokens.filter(
    (token) => /\d/.test(token) || token.length >= 7
  );
  const strictTokens = [
    ...strongTokens.slice(0, 4),
    ...tokens.filter((token) => !strongTokens.includes(token)).slice(0, 2),
  ];
  const strict =
    strictTokens.length >= 2 ? strictTokens.join(" ").slice(0, 100) : null;

  return {
    primary,
    strict: strict && strict !== primary ? strict : null,
    tokens,
    strongTokens,
    tokenSet: new Set(tokens),
  };
}

function scoreResultMatch(result: EbayResearchResult, plan: SearchPlan) {
  const title = normalizeSearchText(result.title);
  const titleTokenSet = new Set(title.split(" ").filter(Boolean));

  if (!title || plan.tokens.length === 0) {
    return 50;
  }

  if (isAccessoryOnlyMismatch(result.title, plan)) {
    return 0;
  }

  let score = 0;
  let matched = 0;
  const titleMatchesSearchToken = (token: string) =>
    token.length <= 2 || /\d/.test(token)
      ? titleTokenSet.has(token)
      : title.includes(token);

  for (const token of plan.tokens) {
    if (titleMatchesSearchToken(token)) {
      matched += 1;
      score += plan.strongTokens.includes(token) ? 12 : 5;
    }
  }

  score += Math.round((matched / plan.tokens.length) * 45);

  if (
    plan.strongTokens.length > 0 &&
    plan.strongTokens.every((token) => titleMatchesSearchToken(token))
  ) {
    score += 25;
  }

  const primaryText = normalizeSearchText(plan.primary);
  if (primaryText && title.includes(primaryText)) {
    score += 20;
  }

  const unrelatedSignals = [
    "manual",
    "empty box",
    "box only",
    "parts only",
    "for parts",
    "spares",
    "repair",
    "case",
    "cover",
    "skin",
    "sticker",
    "cable",
    "charger",
    "mount",
    "bracket",
    "remote",
  ];

  for (const signal of unrelatedSignals) {
    const signalTokens = signal.split(" ");
    const queryContainsSignal = signalTokens.some((token) =>
      plan.tokenSet.has(token)
    );

    if (!queryContainsSignal && title.includes(signal)) {
      score -= signal.includes(" ") ? 35 : 16;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function buildSummary(results: EbayResearchResult[]): EbayResearchSummary {
  const prices = results
    .map((result) => Number(result.landedPrice))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const lowestTen = prices.slice(0, 10);
  const averageLowest10 =
    lowestTen.length > 0
      ? lowestTen.reduce((total, price) => total + price, 0) / lowestTen.length
      : null;
  const medianPrice =
    prices.length === 0
      ? null
      : prices.length % 2 === 1
        ? prices[Math.floor(prices.length / 2)]
        : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  const totalSoldQuantity = results.reduce((total, result) => {
    if (result.source !== "SOLD") {
      return total;
    }

    const quantity = Number(result.soldQuantity);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);

  return {
    count: results.length,
    lowestPrice: prices.length > 0 ? formatMoney(prices[0]) : null,
    averageLowest10:
      averageLowest10 === null ? null : formatMoney(averageLowest10),
    medianPrice: medianPrice === null ? null : formatMoney(medianPrice),
    totalSoldQuantity,
    generatedAt: new Date().toISOString(),
  };
}

function getResultKey(result: EbayResearchResult) {
  return result.itemId || result.url;
}

function getLocationRank(result: EbayResearchResult) {
  const location = result.location?.toLowerCase() ?? "";

  if (
    /\bau\b/.test(location) ||
    location.includes("australia") ||
    /\b(nsw|vic|qld|wa|sa|tas|nt|act)\b/.test(location)
  ) {
    return 0;
  }

  return 1;
}

function dedupeAndSortResults(
  results: EbayResearchResult[],
  limit: number,
  plan?: SearchPlan
) {
  const seen = new Set<string>();
  const seenTitlePrice = new Set<string>();
  const deduped: EbayResearchResult[] = [];

  for (const result of results) {
    const key = getResultKey(result);
    const titlePriceKey = `${normalizeTitleKey(result.title)}|${result.landedPrice}`;

    if (!key || seen.has(key) || seenTitlePrice.has(titlePriceKey)) {
      continue;
    }

    seen.add(key);
    seenTitlePrice.add(titlePriceKey);
    deduped.push({
      ...result,
      matchScore:
        typeof result.matchScore === "number"
          ? result.matchScore
          : plan
            ? scoreResultMatch(result, plan)
            : undefined,
    });
  }

  const filtered = plan
    ? deduped
        .filter((result) => !isAccessoryOnlyMismatch(result.title, plan))
        .filter((result) => {
        const score = result.matchScore ?? 0;
        return score >= (plan.strongTokens.length > 0 ? 55 : 35);
      })
    : deduped;
  const pool = filtered;

  return pool
    .sort((left, right) => {
      if (plan) {
        const scoreDifference = (right.matchScore ?? 0) - (left.matchScore ?? 0);

        if (Math.abs(scoreDifference) > 4) {
          return scoreDifference;
        }
      }

      const locationDifference = getLocationRank(left) - getLocationRank(right);

      if (locationDifference !== 0) {
        return locationDifference;
      }

      const priceDifference = Number(left.landedPrice) - Number(right.landedPrice);

      if (Math.abs(priceDifference) > 0.01) {
        return priceDifference;
      }

      return (right.matchScore ?? 0) - (left.matchScore ?? 0);
    })
    .slice(0, limit);
}

function buildQueryList(plan: SearchPlan, includeStrict: boolean) {
  const queries = [plan.primary];

  if (includeStrict && plan.strict) {
    queries.push(plan.strict);
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function parseSoldQuantity(...values: string[]) {
  const text = values.filter(Boolean).join(" ");
  const patterns = [
    /(\d[\d,]*\+?)\s+(?:items?\s+)?sold/i,
    /sold\s+(\d[\d,]*\+?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const raw = match[1];
    const quantity = Number.parseInt(raw.replace(/[^\d]/g, ""), 10);

    if (Number.isFinite(quantity) && quantity > 0) {
      return {
        quantity,
        text: `${raw} sold`,
      };
    }
  }

  return { quantity: 1, text: "1 sold" };
}

function extractEbayItemId(url: string) {
  const match = url.match(/\/itm\/(?:[^/?#]+\/)?(\d+)/);

  return match?.[1] ?? null;
}

function buildLocation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const location = value as Record<string, unknown>;
  const parts = [
    location.city,
    location.stateOrProvince,
    location.postalCode,
    location.country,
  ].filter((part): part is string => typeof part === "string" && part.trim() !== "");

  return parts.length > 0 ? parts.join(", ") : null;
}

async function getContextPostcode(storeId: string) {
  const settings = await prisma.supplierSettings.findUnique({
    where: {
      storeId_supplierName: {
        storeId,
        supplierName: "Amazon AU",
      },
    },
    select: {
      scrapePostcode: true,
      defaultZipcode: true,
    },
  });

  return (
    settings?.scrapePostcode?.trim() ||
    settings?.defaultZipcode?.trim() ||
    DEFAULT_POSTCODE
  );
}

async function fetchActiveListings(
  storeId: string,
  query: string,
  limit: number,
  conditionFilter: EbayResearchConditionFilter
): Promise<EbayResearchResult[]> {
  const cacheKey = [
    ACTIVE_SEARCH_CACHE_VERSION,
    storeId,
    query.toLowerCase(),
    limit,
    conditionFilter,
  ].join(":");
  const cache = getActiveSearchCache();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const storeNumber = await getStoreNumber(storeId);
  const accessToken = await getOAuthAccessToken(storeNumber);
  const postcode = await getContextPostcode(storeId);
  const url = new URL(`${EBAY_API_BASE_URL}/buy/browse/v1/item_summary/search`);
  const browseLimit = Math.min(200, Math.max(limit * 4, 100));

  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(browseLimit));
  const filters = ["buyingOptions:{FIXED_PRICE}"];
  const conditionFilterParam = getConditionFilterParam(conditionFilter);

  if (conditionFilterParam) {
    filters.push(`conditionIds:{${conditionFilterParam}}`);
  }

  url.searchParams.set("filter", filters.join(","));

  await waitForEbayRateLimit(storeId, "BROWSE");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU",
      "X-EBAY-C-ENDUSERCTX": `contextualLocation=country%3DAU%2Czip%3D${encodeURIComponent(
        postcode
      )}`,
    },
  });

  const responseText = await response.text();

  if (response.status === 429) {
    await recordEbayRateLimitBackoff(storeId, "BROWSE", `HTTP ${response.status}`);
  }

  if (!response.ok) {
    logger.error(
      "ebay-research/active",
      `Browse API search failed with HTTP ${response.status}`,
      undefined,
      { status: response.status, responseBody: responseText.slice(0, 1000) }
    );
    throw new Error(getBrowseApiErrorMessage(response.status));
  }

  const data = JSON.parse(responseText) as {
    itemSummaries?: Array<Record<string, unknown>>;
  };
  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

  const results = items
    .map((item): EbayResearchResult | null => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const url = typeof item.itemWebUrl === "string" ? item.itemWebUrl : "";

      if (!title || !url) {
        return null;
      }

      const price = item.price as { value?: string; currency?: string } | undefined;
      const shippingOptions = Array.isArray(item.shippingOptions)
        ? item.shippingOptions
        : [];
      const firstShipping = shippingOptions[0] as
        | { shippingCost?: { value?: string } }
        | undefined;
      const itemPrice = parsePrice(price?.value);
      const shippingPrice = parsePrice(firstShipping?.shippingCost?.value);
      const image =
        item.image && typeof item.image === "object" && !Array.isArray(item.image)
          ? (item.image as { imageUrl?: unknown })
          : null;
      const seller =
        item.seller && typeof item.seller === "object" && !Array.isArray(item.seller)
          ? (item.seller as { username?: unknown })
          : null;

      return {
        source: "ACTIVE",
        itemId:
          typeof item.itemId === "string"
            ? item.itemId.replace(/^v1\|/, "").split("|")[0]
            : extractEbayItemId(url),
        title,
        url,
        imageUrl: typeof image?.imageUrl === "string" ? image.imageUrl : null,
        seller: typeof seller?.username === "string" ? seller.username : null,
        condition:
          typeof item.condition === "string" ? item.condition : null,
        itemPrice: formatMoney(itemPrice),
        shippingPrice: formatMoney(shippingPrice),
        landedPrice: formatMoney(itemPrice + shippingPrice),
        currency: "AUD",
        location: buildLocation(item.itemLocation),
        listedAt:
          typeof item.itemCreationDate === "string" ? item.itemCreationDate : null,
      };
    })
    .filter((result): result is EbayResearchResult => result !== null);

  const sortedResults = dedupeAndSortResults(results, browseLimit);

  cache.set(cacheKey, {
    expiresAt: Date.now() + ACTIVE_SEARCH_CACHE_TTL_MS,
    results: sortedResults,
  });

  return sortedResults;
}

async function scrapeSoldListings(
  query: string,
  limit: number,
  conditionFilter: EbayResearchConditionFilter
): Promise<EbayResearchResult[]> {
  const candidateLimit = Math.min(200, Math.max(limit * 4, 100));
  const browser = await launchScraperBrowser();
  const context = await browser.newContext({
    locale: "en-AU",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });

  try {
    const page = await context.newPage();
    const url = new URL("https://www.ebay.com.au/sch/i.html");

    url.searchParams.set("_nkw", query);
    url.searchParams.set("LH_Sold", "1");
    url.searchParams.set("LH_Complete", "1");
    url.searchParams.set("LH_BIN", "1");
    url.searchParams.set("_sop", "15");
    const conditionFilterParam = getConditionFilterParam(conditionFilter);

    if (conditionFilterParam) {
      url.searchParams.set("LH_ItemCondition", conditionFilterParam);
    }

    await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector(".s-item", { timeout: 15000 }).catch(() => null);

    const rawResults = await page.$$eval(".s-item", (items) =>
      items.map((item) => {
        const getText = (selector: string) =>
          item.querySelector(selector)?.textContent?.trim() ?? "";
        const link = item.querySelector<HTMLAnchorElement>(".s-item__link");
        const image = item.querySelector<HTMLImageElement>(".s-item__image img");

        return {
          title: getText(".s-item__title"),
          url: link?.href ?? "",
          imageUrl: image?.src || image?.getAttribute("data-src") || "",
          price: getText(".s-item__price"),
          shipping: getText(".s-item__shipping"),
          seller: getText(".s-item__seller-info-text"),
          condition: getText(".SECONDARY_INFO"),
          location: getText(".s-item__location"),
          soldText:
            getText(".s-item__quantitySold") ||
            getText(".s-item__hotness") ||
            getText(".s-item__dynamic") ||
            getText(".s-item__additionalItemInfo") ||
            getText(".s-item__subtitle") ||
            getText(".s-item__detail--secondary"),
          cardText: item.textContent?.trim() ?? "",
          soldAt:
            getText(".s-item__title--tagblock") ||
            getText(".s-item__ended-date") ||
            getText(".s-item__caption--signal"),
        };
      })
    );

    const results = rawResults
      .map((item): EbayResearchResult | null => {
        const title = item.title.replace(/^New Listing/i, "").trim();

        if (!title || title === "Shop on eBay" || !item.url) {
          return null;
        }

        const itemPrice = parsePrice(item.price);
        const shippingPrice =
          /free/i.test(item.shipping) || item.shipping.trim() === ""
            ? 0
            : parsePrice(item.shipping);

        if (itemPrice <= 0) {
          return null;
        }

        const soldCount = parseSoldQuantity(item.soldText, item.cardText);

        return {
          source: "SOLD",
          itemId: extractEbayItemId(item.url),
          title,
          url: item.url,
          imageUrl: item.imageUrl || null,
          seller: item.seller || null,
          condition: item.condition || null,
          itemPrice: formatMoney(itemPrice),
          shippingPrice: formatMoney(shippingPrice),
          landedPrice: formatMoney(itemPrice + shippingPrice),
          currency: "AUD",
          location: item.location || null,
          soldAt: item.soldAt || null,
          soldQuantity: soldCount.quantity,
          soldCountText: soldCount.text,
        };
      })
      .filter((result): result is EbayResearchResult => result !== null);

    const conditionFilteredResults =
      conditionFilter === EbayResearchConditionFilter.ANY
        ? results
        : results.filter((result) =>
            conditionMatchesFilter(result.condition, conditionFilter)
          );

    return dedupeAndSortResults(conditionFilteredResults, candidateLimit);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function fetchActiveForQueries(
  storeId: string,
  queries: string[],
  limit: number,
  conditionFilter: EbayResearchConditionFilter
): Promise<QuerySetResult> {
  const settled = await Promise.allSettled(
    queries.map((query) =>
      fetchActiveListings(storeId, query, limit, conditionFilter)
    )
  );
  const results: EbayResearchResult[] = [];
  const errors: string[] = [];
  let succeeded = false;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      succeeded = true;
      results.push(...result.value);
    } else {
      errors.push(getErrorMessage(result.reason));
    }
  }

  return { results, succeeded, errors };
}

async function scrapeSoldForQueries(
  queries: string[],
  limit: number,
  conditionFilter: EbayResearchConditionFilter
): Promise<QuerySetResult> {
  const results: EbayResearchResult[] = [];
  const errors: string[] = [];
  let succeeded = false;

  for (const query of queries) {
    try {
      results.push(...(await scrapeSoldListings(query, limit, conditionFilter)));
      succeeded = true;
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  return { results, succeeded, errors };
}

async function saveResearchSnapshot(
  jobId: string,
  activeResults: EbayResearchResult[],
  soldResults: EbayResearchResult[]
) {
  await prisma.ebayResearchJob.update({
    where: { id: jobId },
    data: {
      activeCount: activeResults.length,
      soldCount: soldResults.length,
      activeSummary: buildSummary(activeResults),
      soldSummary: buildSummary(soldResults),
      activeResults: activeResults as unknown as Prisma.InputJsonValue,
      soldResults: soldResults as unknown as Prisma.InputJsonValue,
    },
  });
}

function getResearchPhase(job: EbayResearchJobRecord): EbayResearchPhase {
  if (
    job.status === EbayResearchJobStatus.COMPLETED ||
    job.status === EbayResearchJobStatus.PARTIAL ||
    job.status === EbayResearchJobStatus.FAILED
  ) {
    return "COMPLETE";
  }

  if (job.status === EbayResearchJobStatus.RUNNING && (job.activeCount > 0 || job.soldCount > 0)) {
    return "REFINING";
  }

  return "QUICK";
}

function canPauseBatch(batch: EbayResearchBatchRecord) {
  return (
    batch.status === EbayResearchBatchStatus.QUEUED ||
    batch.status === EbayResearchBatchStatus.RUNNING
  );
}

function canResumeBatch(batch: EbayResearchBatchRecord) {
  return batch.status === EbayResearchBatchStatus.PAUSED;
}

function serializeEbayResearchBatch(batch: EbayResearchBatchRecord) {
  const jobs = batch.jobs ?? [];
  const queuedJobIds = jobs
    .filter(
      (job) =>
        job.status === EbayResearchJobStatus.QUEUED ||
        job.status === EbayResearchJobStatus.PAUSED
    )
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((job) => job.id);
  const running = jobs.filter(
    (job) =>
      job.status === EbayResearchJobStatus.RUNNING ||
      job.status === EbayResearchJobStatus.PAUSING
  ).length;
  const queued = jobs.filter((job) => job.status === EbayResearchJobStatus.QUEUED)
    .length;
  const paused = jobs.filter((job) => job.status === EbayResearchJobStatus.PAUSED)
    .length;

  return {
    id: batch.id,
    storeId: batch.storeId,
    status: batch.status,
    total: batch.total,
    completed: batch.completed,
    failed: batch.failed,
    running,
    queued,
    paused,
    canPause: canPauseBatch(batch),
    canResume: canResumeBatch(batch),
    cooldownUntil: batch.cooldownUntil?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    pausedAt: batch.pausedAt?.toISOString() ?? null,
    expiresAt: batch.expiresAt?.toISOString() ?? null,
    jobs: jobs.map((job) => ({
      ...serializeEbayResearchJob({ ...job, batch }),
      queuePosition: queuedJobIds.includes(job.id)
        ? queuedJobIds.indexOf(job.id) + 1
        : null,
    })),
  };
}

async function refreshResearchBatch(batchId: string) {
  const batch = await prisma.ebayResearchBatch.findUnique({
    where: { id: batchId },
    include: { jobs: true },
  });

  if (!batch) {
    return null;
  }

  const completed = batch.jobs.filter(
    (job) =>
      job.status === EbayResearchJobStatus.COMPLETED ||
      job.status === EbayResearchJobStatus.PARTIAL
  ).length;
  const failed = batch.jobs.filter(
    (job) => job.status === EbayResearchJobStatus.FAILED
  ).length;
  const running = batch.jobs.some(
    (job) =>
      job.status === EbayResearchJobStatus.RUNNING ||
      job.status === EbayResearchJobStatus.PAUSING
  );
  const queued = batch.jobs.some((job) => job.status === EbayResearchJobStatus.QUEUED);
  const paused = batch.jobs.some((job) => job.status === EbayResearchJobStatus.PAUSED);
  const terminalCount = completed + failed;
  let status = batch.status;
  let completedAt = batch.completedAt;
  let pausedAt = batch.pausedAt;
  let expiresAt = batch.expiresAt;

  if (terminalCount >= batch.total) {
    status =
      failed === batch.total
        ? EbayResearchBatchStatus.FAILED
        : failed > 0
          ? EbayResearchBatchStatus.PARTIAL
          : EbayResearchBatchStatus.COMPLETED;
    completedAt = batch.completedAt ?? new Date();
    expiresAt = batch.expiresAt ?? getResearchExpiresAt(completedAt);
  } else if (running) {
    status =
      batch.status === EbayResearchBatchStatus.PAUSING
        ? EbayResearchBatchStatus.PAUSING
        : EbayResearchBatchStatus.RUNNING;
    expiresAt = null;
  } else if (paused && !queued) {
    status = EbayResearchBatchStatus.PAUSED;
    pausedAt = batch.pausedAt ?? new Date();
    expiresAt = null;
  } else if (queued) {
    status =
      batch.status === EbayResearchBatchStatus.PAUSED
        ? EbayResearchBatchStatus.PAUSED
        : EbayResearchBatchStatus.QUEUED;
    expiresAt = null;
  }

  return prisma.ebayResearchBatch.update({
    where: { id: batch.id },
    data: {
      status,
      completed,
      failed,
      completedAt,
      pausedAt,
      expiresAt,
      cooldownUntil:
        status === EbayResearchBatchStatus.COMPLETED ||
        status === EbayResearchBatchStatus.PARTIAL ||
        status === EbayResearchBatchStatus.FAILED ||
        status === EbayResearchBatchStatus.PAUSED
          ? null
          : batch.cooldownUntil,
    },
    include: { jobs: true },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function recoverStaleResearchJobs(storeId: string) {
  const runningJobIds = getRunningJobIds();
  const staleJobs = await prisma.ebayResearchJob.findMany({
    where: {
      storeId,
      status: {
        in: [EbayResearchJobStatus.RUNNING, EbayResearchJobStatus.PAUSING],
      },
    },
    include: { batch: true },
  });
  const batchIds = new Set<string>();

  for (const job of staleJobs) {
    if (runningJobIds.has(job.id)) {
      continue;
    }

    const shouldRemainPaused =
      job.status === EbayResearchJobStatus.PAUSING ||
      job.batch?.status === EbayResearchBatchStatus.PAUSING ||
      job.batch?.status === EbayResearchBatchStatus.PAUSED;

    await prisma.ebayResearchJob.update({
      where: { id: job.id },
      data: {
        status: shouldRemainPaused
          ? EbayResearchJobStatus.PAUSED
          : EbayResearchJobStatus.QUEUED,
        startedAt: null,
        errorMessage: null,
        expiresAt: null,
      },
    });

    if (job.batchId) {
      batchIds.add(job.batchId);
    }
  }

  for (const batchId of batchIds) {
    await refreshResearchBatch(batchId);
  }
}

async function findNextQueuedResearchJob(storeId: string) {
  return prisma.ebayResearchJob.findFirst({
    where: {
      storeId,
      status: EbayResearchJobStatus.QUEUED,
      OR: [
        { batchId: null },
        {
          batch: {
            status: {
              notIn: [
                EbayResearchBatchStatus.PAUSED,
                EbayResearchBatchStatus.PAUSING,
                EbayResearchBatchStatus.COMPLETED,
                EbayResearchBatchStatus.PARTIAL,
                EbayResearchBatchStatus.FAILED,
              ],
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: { batch: true },
  });
}

async function hasQueuedJobsInBatch(batchId: string) {
  const count = await prisma.ebayResearchJob.count({
    where: { batchId, status: EbayResearchJobStatus.QUEUED },
  });

  return count > 0;
}

export function serializeEbayResearchJob(
  job: EbayResearchJobRecord,
  options: { includeResults?: boolean } = {}
) {
  const includeResults = options.includeResults ?? true;
  const batchStatus = job.batch?.status ?? null;

  return {
    id: job.id,
    storeId: job.storeId,
    batchId: job.batchId,
    batchStatus,
    queuePosition: null,
    canPause: false,
    canResume: false,
    cooldownUntil: job.batch?.cooldownUntil?.toISOString() ?? null,
    status: job.status,
    phase: getResearchPhase(job),
    mode: job.mode,
    conditionFilter: job.conditionFilter,
    query: job.query,
    limit: job.limit,
    activeCount: job.activeCount,
    soldCount: job.soldCount,
    activeSummary: asJsonSummary(job.activeSummary),
    soldSummary: asJsonSummary(job.soldSummary),
    activeResults: includeResults ? asJsonResults(job.activeResults) : [],
    soldResults: includeResults ? asJsonResults(job.soldResults) : [],
    warningMessage: job.warningMessage,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

async function runEbayResearchJobClaimed(jobId: string) {
  const job = await prisma.ebayResearchJob.findUnique({
    where: { id: jobId },
    include: { batch: true },
  });

  if (
    !job ||
    job.status !== EbayResearchJobStatus.QUEUED ||
    job.batch?.status === EbayResearchBatchStatus.PAUSED ||
    job.batch?.status === EbayResearchBatchStatus.PAUSING
  ) {
    return;
  }

  await prisma.ebayResearchJob.update({
    where: { id: job.id },
    data: {
      status: EbayResearchJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      warningMessage: null,
      errorMessage: null,
      expiresAt: null,
    },
  });

  if (job.batchId) {
    await prisma.ebayResearchBatch.update({
      where: { id: job.batchId },
      data: {
        status: EbayResearchBatchStatus.RUNNING,
        startedAt: job.batch?.startedAt ?? new Date(),
        pausedAt: null,
        expiresAt: null,
      },
    });
  }

  const activeRequested =
    job.mode === EbayResearchMode.ACTIVE || job.mode === EbayResearchMode.BOTH;
  const soldRequested =
    job.mode === EbayResearchMode.SOLD || job.mode === EbayResearchMode.BOTH;
  const conditionFilter = job.conditionFilter;
  const searchPlan = buildSearchPlan(job.query);
  const quickLimit = Math.min(job.limit, 30);
  const quickQueries = buildQueryList(searchPlan, false);
  const deepQueries = buildQueryList(searchPlan, true);
  let activeResults: EbayResearchResult[] = [];
  let soldResults: EbayResearchResult[] = [];
  const activeErrors: string[] = [];
  const soldErrors: string[] = [];
  let activeSucceeded = !activeRequested;
  let soldSucceeded = !soldRequested;

  const [quickActive, quickSold] = await Promise.all([
    activeRequested
      ? fetchActiveForQueries(
          job.storeId,
          quickQueries,
          quickLimit,
          conditionFilter
        )
      : Promise.resolve({ results: [], succeeded: true, errors: [] }),
    soldRequested
      ? scrapeSoldForQueries(quickQueries, quickLimit, conditionFilter)
      : Promise.resolve({ results: [], succeeded: true, errors: [] }),
  ]);

  activeSucceeded ||= quickActive.succeeded;
  soldSucceeded ||= quickSold.succeeded;
  activeErrors.push(...quickActive.errors);
  soldErrors.push(...quickSold.errors);
  activeResults = dedupeAndSortResults(quickActive.results, job.limit, searchPlan);
  soldResults = dedupeAndSortResults(quickSold.results, job.limit, searchPlan);

  await saveResearchSnapshot(job.id, activeResults, soldResults);

  const [deepActive, deepSold] = await Promise.all([
    activeRequested
      ? fetchActiveForQueries(
          job.storeId,
          deepQueries,
          job.limit,
          conditionFilter
        )
      : Promise.resolve({ results: [], succeeded: true, errors: [] }),
    soldRequested
      ? scrapeSoldForQueries(deepQueries, job.limit, conditionFilter)
      : Promise.resolve({ results: [], succeeded: true, errors: [] }),
  ]);

  activeSucceeded ||= deepActive.succeeded;
  soldSucceeded ||= deepSold.succeeded;
  activeErrors.push(...deepActive.errors);
  soldErrors.push(...deepSold.errors);
  activeResults = dedupeAndSortResults(
    [...activeResults, ...deepActive.results],
    job.limit,
    searchPlan
  );
  soldResults = dedupeAndSortResults(
    [...soldResults, ...deepSold.results],
    job.limit,
    searchPlan
  );

  const completedAt = new Date();
  const status =
    activeSucceeded && soldSucceeded
      ? EbayResearchJobStatus.COMPLETED
      : activeResults.length > 0 || soldResults.length > 0
        ? EbayResearchJobStatus.PARTIAL
        : EbayResearchJobStatus.FAILED;
  const warnings = [
    !activeSucceeded && activeRequested
      ? `Active listings: ${activeErrors.join(" ")}`
      : null,
    !soldSucceeded && soldRequested ? `Sold comps: ${soldErrors.join(" ")}` : null,
  ].filter((message): message is string => Boolean(message));

  await prisma.ebayResearchJob.update({
    where: { id: job.id },
    data: {
      status,
      activeCount: activeResults.length,
      soldCount: soldResults.length,
      activeSummary: buildSummary(activeResults),
      soldSummary: buildSummary(soldResults),
      activeResults: activeResults as unknown as Prisma.InputJsonValue,
      soldResults: soldResults as unknown as Prisma.InputJsonValue,
      warningMessage:
        status === EbayResearchJobStatus.PARTIAL && warnings.length > 0
          ? warnings.join(" ")
          : null,
      errorMessage:
        status === EbayResearchJobStatus.FAILED
          ? warnings.join(" ") || "eBay research failed."
          : null,
      completedAt,
      expiresAt: getResearchExpiresAt(completedAt),
    },
  });

  logger.info("ebay-research/jobs", "eBay research job finished", {
    jobId: job.id,
    status,
    activeCount: activeResults.length,
    soldCount: soldResults.length,
  });

  if (job.batchId) {
    const refreshedBatch = await refreshResearchBatch(job.batchId);

    if (
      refreshedBatch &&
      (refreshedBatch.status === EbayResearchBatchStatus.QUEUED ||
        refreshedBatch.status === EbayResearchBatchStatus.RUNNING) &&
      (await hasQueuedJobsInBatch(refreshedBatch.id))
    ) {
      await prisma.ebayResearchBatch.update({
        where: { id: refreshedBatch.id },
        data: {
          cooldownUntil: new Date(Date.now() + RESEARCH_BATCH_COOLDOWN_MS),
        },
      });
    }
  }
}

async function runEbayResearchJob(jobId: string, worker?: WorkerContext) {
  if (!worker) {
    await runEbayResearchJobClaimed(jobId);
    return;
  }

  const job = await prisma.ebayResearchJob.findUnique({
    where: { id: jobId },
    include: { batch: true },
  });

  if (
    !job ||
    job.status !== EbayResearchJobStatus.QUEUED ||
    job.batch?.status === EbayResearchBatchStatus.PAUSED ||
    job.batch?.status === EbayResearchBatchStatus.PAUSING
  ) {
    return;
  }

  await withJobLeases(
    getEbayReadLeaseInput(
      job.storeId,
      "EBAY_RESEARCH",
      job.id,
      worker,
      job.batchId ? "eBay research batch" : "eBay research"
    ),
    () => runEbayResearchJobClaimed(job.id)
  );
}

async function runEbayResearchQueue(storeId: string, worker?: WorkerContext) {
  await recoverStaleResearchJobs(storeId);

  while (true) {
    const nextJob = await findNextQueuedResearchJob(storeId);

    if (!nextJob) {
      return;
    }

    const cooldownUntil = nextJob.batch?.cooldownUntil;

    if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
      await sleep(cooldownUntil.getTime() - Date.now());
      continue;
    }

    const runningJobIds = getRunningJobIds();
    runningJobIds.add(nextJob.id);

    try {
      await runEbayResearchJob(nextJob.id, worker);
    } finally {
      runningJobIds.delete(nextJob.id);
    }
  }
}

export async function runEbayResearchQueueForStore(
  storeId: string,
  worker?: WorkerContext
) {
  try {
    await runEbayResearchQueue(storeId, worker);
  } catch (error) {
    if (error instanceof JobConflictError) {
      return;
    }

    throw error;
  }
}

export async function cleanupExpiredEbayResearchRecords(
  storeId?: string,
  options: { force?: boolean } = {}
) {
  const now = new Date();
  const storeFilter = storeId ? { storeId } : {};
  const cleanupKey = storeId ?? "__all__";
  const cleanupCache = getCleanupCache();

  if (!options.force) {
    const lastCleanupAt = cleanupCache.get(cleanupKey) ?? 0;

    if (Date.now() - lastCleanupAt < RESEARCH_CLEANUP_INTERVAL_MS) {
      return {
        deletedBatches: 0,
        deletedJobs: 0,
        skipped: true,
      };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batches = await tx.ebayResearchBatch.deleteMany({
        where: {
          ...storeFilter,
          expiresAt: { lte: now },
          status: { in: TERMINAL_RESEARCH_BATCH_STATUSES },
        },
      });
      const standaloneJobs = await tx.ebayResearchJob.deleteMany({
        where: {
          ...storeFilter,
          batchId: null,
          expiresAt: { lte: now },
          status: { in: TERMINAL_RESEARCH_JOB_STATUSES },
        },
      });

      return {
        deletedBatches: batches.count,
        deletedJobs: standaloneJobs.count,
        skipped: false,
      };
    });

    cleanupCache.set(cleanupKey, Date.now());
    return result;
  } catch (error) {
    if (options.force) {
      throw error;
    }

    cleanupCache.set(cleanupKey, Date.now());
    logger.warn(
      "ebay-research/cleanup",
      "Skipped expired research cleanup during page read",
      {
        storeId,
        errorMessage: getErrorMessage(error),
      }
    );

    return {
      deletedBatches: 0,
      deletedJobs: 0,
      skipped: true,
    };
  }
}

export async function createEbayResearchJob(input: CreateEbayResearchJobInput) {
  const query = normalizeQuery(input.query);
  const mode = normalizeMode(input.mode);
  const limit = normalizeLimit(input.limit);
  const conditionFilter = normalizeConditionFilter(input.conditionFilter);
  await assertNoEbayLaneStartConflict(input.storeId, "read");
  const job = await prisma.ebayResearchJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      query,
      mode,
      limit,
      conditionFilter,
    },
    include: { batch: true },
  });

  return serializeEbayResearchJob(job);
}

export async function createEbayResearchBatch(input: CreateEbayResearchBatchInput) {
  const queries = normalizeBatchQueries(input.queries);
  const limit = normalizeLimit(input.limit);
  const conditionFilter = normalizeConditionFilter(input.conditionFilter);
  await assertNoEbayLaneStartConflict(input.storeId, "read");
  const batch = await prisma.$transaction(async (tx) => {
    const createdBatch = await tx.ebayResearchBatch.create({
      data: {
        userId: input.userId,
        storeId: input.storeId,
        total: queries.length,
      },
    });

    await tx.ebayResearchJob.createMany({
      data: queries.map((query) => ({
        userId: input.userId,
        storeId: input.storeId,
        batchId: createdBatch.id,
        query,
        mode: EbayResearchMode.ACTIVE,
        limit,
        conditionFilter,
      })),
    });

    return tx.ebayResearchBatch.findUniqueOrThrow({
      where: { id: createdBatch.id },
      include: { jobs: { orderBy: { createdAt: "asc" } } },
    });
  });

  return serializeEbayResearchBatch(batch);
}

export async function getRecentEbayResearchJobs(storeId: string) {
  await cleanupExpiredEbayResearchRecords(storeId);
  const jobs = await prisma.ebayResearchJob.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { batch: true },
  });

  return jobs.map((job) => serializeEbayResearchJob(job, { includeResults: false }));
}

export async function getEbayResearchJobForStore(jobId: string, storeId: string) {
  await cleanupExpiredEbayResearchRecords(storeId);
  const job = await prisma.ebayResearchJob.findFirst({
    where: { id: jobId, storeId },
    include: { batch: true },
  });

  return job ? serializeEbayResearchJob(job) : null;
}

export async function recoverEbayResearchQueue(storeId: string) {
  await cleanupExpiredEbayResearchRecords(storeId);
}

export async function getCurrentEbayResearchBatches(storeId: string) {
  await recoverEbayResearchQueue(storeId);
  const batches = await prisma.ebayResearchBatch.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });

  return batches.map(serializeEbayResearchBatch);
}

export async function pauseEbayResearchBatch(batchId: string, storeId: string) {
  const batch = await prisma.ebayResearchBatch.findFirst({
    where: { id: batchId, storeId },
    include: { jobs: true },
  });

  if (!batch) {
    return null;
  }

  if (!canPauseBatch(batch)) {
    return serializeEbayResearchBatch(batch);
  }

  const hasRunningJob = batch.jobs.some(
    (job) =>
      job.status === EbayResearchJobStatus.RUNNING ||
      job.status === EbayResearchJobStatus.PAUSING
  );
  const nextBatchStatus = hasRunningJob
    ? EbayResearchBatchStatus.PAUSING
    : EbayResearchBatchStatus.PAUSED;

  await prisma.$transaction([
    prisma.ebayResearchBatch.update({
      where: { id: batch.id },
      data: {
        status: nextBatchStatus,
        pausedAt: hasRunningJob ? null : new Date(),
        cooldownUntil: null,
        expiresAt: null,
      },
    }),
    prisma.ebayResearchJob.updateMany({
      where: { batchId: batch.id, status: EbayResearchJobStatus.QUEUED },
      data: { status: EbayResearchJobStatus.PAUSED },
    }),
    prisma.ebayResearchJob.updateMany({
      where: { batchId: batch.id, status: EbayResearchJobStatus.RUNNING },
      data: { status: EbayResearchJobStatus.PAUSING },
    }),
  ]);

  const refreshed = await refreshResearchBatch(batch.id);
  return refreshed ? serializeEbayResearchBatch(refreshed) : null;
}

export async function resumeEbayResearchBatch(batchId: string, storeId: string) {
  const batch = await prisma.ebayResearchBatch.findFirst({
    where: { id: batchId, storeId },
    include: { jobs: true },
  });

  if (!batch) {
    return null;
  }

  if (!canResumeBatch(batch)) {
    return serializeEbayResearchBatch(batch);
  }

  await assertNoEbayLaneStartConflict(storeId, "read", {
    excludeResearchBatchId: batch.id,
  });

  await prisma.$transaction([
    prisma.ebayResearchBatch.update({
      where: { id: batch.id },
      data: {
        status: EbayResearchBatchStatus.QUEUED,
        pausedAt: null,
        cooldownUntil: null,
        expiresAt: null,
      },
    }),
    prisma.ebayResearchJob.updateMany({
      where: {
        batchId: batch.id,
        status: {
          in: [EbayResearchJobStatus.PAUSED, EbayResearchJobStatus.PAUSING],
        },
      },
      data: { status: EbayResearchJobStatus.QUEUED, expiresAt: null },
    }),
  ]);

  const refreshed = await refreshResearchBatch(batch.id);

  return refreshed ? serializeEbayResearchBatch(refreshed) : null;
}

export { VALID_LIMITS };
