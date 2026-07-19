import { PriceCheckFailureCode } from "@/app/generated/prisma/enums";

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
  /sorry[, ]+something went wrong/i,
  /service unavailable/i,
];

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

export function isPriceCheckAutoHoldMetadata(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).kind === "price-check-auto-hold",
  );
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
