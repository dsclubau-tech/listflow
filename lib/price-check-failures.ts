import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";
import { getAmazonPriceUnavailableMessage } from "@/lib/amazon-price-tracking";
import {
  isAmazonStockHealthy,
  isResolvedLowStockHoldReason,
} from "@/lib/low-stock-products";

export const PRICE_CHECK_AUTO_HOLD_REASON_PREFIX =
  "Automatic hold after failed price check";
export const PRICE_CHECK_AUTO_RESUME_JOB_KIND = "price-check-auto-resume";
export const PRICE_CHECK_AUTO_RESUME_REASON =
  "limited-time-deal-price-restored";

export function getPriceCheckAutoHoldReason(message?: string | null) {
  const normalizedMessage = message?.trim();
  return normalizedMessage
    ? `${PRICE_CHECK_AUTO_HOLD_REASON_PREFIX}: ${normalizedMessage}`
    : `${PRICE_CHECK_AUTO_HOLD_REASON_PREFIX}.`;
}

export const DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON =
  getPriceCheckAutoHoldReason(getAmazonPriceUnavailableMessage("DEAL"));

export const AUTO_HOLD_PRICE_CHECK_FAILURE_CODES = [
  PriceCheckFailureCode.AMAZON_OUT_OF_STOCK,
  PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE,
  PriceCheckFailureCode.MISSING_BASELINE,
  PriceCheckFailureCode.UNSAFE_PRICE_CHANGE,
] as const;

const AUTO_HOLD_FAILURE_CODES = new Set<PriceCheckFailureCode>(
  AUTO_HOLD_PRICE_CHECK_FAILURE_CODES,
);

const AMAZON_TECHNICAL_PAGE_PATTERNS = [
  /robot check/i,
  /validatecaptcha/i,
  /enter the characters you see/i,
  /automated access/i,
  /page not found/i,
  /not a functioning page/i,
  /sorry[, ]+something went wrong/i,
  /service unavailable/i,
];

function amazonUrlContainsAsin(url: string, asin: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host !== "amazon.com.au" && !host.endsWith(".amazon.com.au")) {
      return false;
    }

    const escapedAsin = asin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`/(?:dp|gp/product)/${escapedAsin}(?:[/?]|$)`, "i").test(
      parsed.pathname,
    );
  } catch {
    return false;
  }
}

export class PriceCheckFailure extends Error {
  readonly code: PriceCheckFailureCode;

  constructor(code: PriceCheckFailureCode, message: string) {
    super(message);
    this.name = "PriceCheckFailure";
    this.code = code;
  }
}

export function isAutoHoldPriceCheckFailureCode(
  code: PriceCheckFailureCode | null | undefined,
) {
  return Boolean(code && AUTO_HOLD_FAILURE_CODES.has(code));
}

export function getPriceCheckFailureCode(error: unknown) {
  return error instanceof PriceCheckFailure
    ? error.code
    : PriceCheckFailureCode.TECHNICAL_ERROR;
}

export function getAmazonTechnicalPageMessage(input: {
  title: string;
  url: string;
  bodyText: string;
}) {
  const combined = `${input.title}\n${input.url}\n${input.bodyText}`;

  return AMAZON_TECHNICAL_PAGE_PATTERNS.some((pattern) => pattern.test(combined))
    ? "Amazon returned a challenge or temporary error page instead of a product page."
    : null;
}

export function isVerifiedAmazonProductPage(input: {
  expectedAsin: string;
  url: string;
  canonicalUrl?: string | null;
  pageAsins?: Array<string | null | undefined>;
}) {
  const expectedAsin = input.expectedAsin.trim().toUpperCase();

  if (!expectedAsin) {
    return false;
  }

  if (
    amazonUrlContainsAsin(input.url, expectedAsin) ||
    (input.canonicalUrl &&
      amazonUrlContainsAsin(input.canonicalUrl, expectedAsin))
  ) {
    return true;
  }

  return (input.pageAsins ?? []).some(
    (asin) => asin?.trim().toUpperCase() === expectedAsin,
  );
}

export function isPriceCheckAutoHoldMetadata(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).kind === "price-check-auto-hold",
  );
}

export function isPriceCheckAutoResumeMetadata(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).kind ===
        PRICE_CHECK_AUTO_RESUME_JOB_KIND,
  );
}

export function getPriceCheckAutoResumeMetadata(
  source:
    | { sourcePriceCheckJobId: string }
    | { source: "direct-price-check" },
) {
  return {
    kind: PRICE_CHECK_AUTO_RESUME_JOB_KIND,
    reason: PRICE_CHECK_AUTO_RESUME_REASON,
    ...source,
  } as const;
}

type AutoHoldCandidate = {
  id: string;
  status: string;
  ebayItemId: string | null;
  priceCheckError: string | null;
  priceCheckFailureCode: PriceCheckFailureCode | null;
};

export function selectPriceCheckAutoHoldProductIds(input: {
  enabled: boolean;
  products: AutoHoldCandidate[];
  coveredProductIds?: Iterable<string>;
}) {
  if (!input.enabled) {
    return [];
  }

  const covered = new Set(input.coveredProductIds ?? []);

  return input.products
    .filter(
      (product) =>
        product.status === "IMPORTED" &&
        Boolean(product.ebayItemId) &&
        Boolean(product.priceCheckError) &&
        isAutoHoldPriceCheckFailureCode(product.priceCheckFailureCode) &&
        !covered.has(product.id),
    )
    .map((product) => product.id);
}

type AutoResumeCandidate = {
  id: string;
  status: string;
  ebayItemId: string | null;
  amazonPriceTrackingMode: string;
  amazonPrice: unknown;
  holdReason: string | null;
  priceCheckError: string | null;
  priceCheckFailureCode: PriceCheckFailureCode | null;
  amazonStockLeft?: number | null;
};

function hasValidRecoveredPrice(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }

  const numericValue =
    typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(numericValue) && numericValue > 0;
}

export function isRecoveredDealPriceAutoHold(product: AutoResumeCandidate) {
  return (
    product.status === "ON_HOLD" &&
    Boolean(product.ebayItemId) &&
    product.amazonPriceTrackingMode === "DEAL" &&
    hasValidRecoveredPrice(product.amazonPrice) &&
    product.holdReason === DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON &&
    !product.priceCheckError &&
    !product.priceCheckFailureCode
  );
}

export function isRecoveredLowStockAutoHold(product: AutoResumeCandidate) {
  return (
    product.status === "ON_HOLD" &&
    Boolean(product.ebayItemId) &&
    isResolvedLowStockHoldReason(product.holdReason) &&
    isAmazonStockHealthy(product.amazonStockLeft) &&
    !product.priceCheckError &&
    !product.priceCheckFailureCode
  );
}

export function isRecoveredPriceCheckAutoHold(product: AutoResumeCandidate) {
  return (
    isRecoveredDealPriceAutoHold(product) ||
    isRecoveredLowStockAutoHold(product)
  );
}

export function selectPriceCheckAutoResumeProductIds(input: {
  products: AutoResumeCandidate[];
  coveredProductIds?: Iterable<string>;
}) {
  const covered = new Set(input.coveredProductIds ?? []);

  return input.products
    .filter(
      (product) =>
        isRecoveredPriceCheckAutoHold(product) && !covered.has(product.id),
    )
    .map((product) => product.id);
}
