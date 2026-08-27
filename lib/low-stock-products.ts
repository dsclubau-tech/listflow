import { ProductStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";

export const LOW_STOCK_THRESHOLD = 3;
export const LOW_STOCK_HOLD_JOB_KIND = "low-stock-bulk-hold";
export const LOW_STOCK_RESOLVED_HOLD_REASON =
  "Low Amazon stock resolved — product is back in stock on Amazon.";

export function isLowStockHoldJobMetadata(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === LOW_STOCK_HOLD_JOB_KIND
  );
}

export function getLowStockProductWhere(storeId: string) {
  return {
    storeId,
    status: ProductStatus.IMPORTED,
    asin: { not: null },
    amazonStockLeft: { not: null, lte: LOW_STOCK_THRESHOLD },
  } satisfies Prisma.ProductWhereInput;
}

export function isAmazonStockHealthy(stockLeft: number | null | undefined) {
  return (
    stockLeft === null ||
    (typeof stockLeft === "number" && stockLeft > LOW_STOCK_THRESHOLD)
  );
}

export function isResolvedLowStockHoldReason(reason: string | null | undefined) {
  return reason === LOW_STOCK_RESOLVED_HOLD_REASON;
}

export function getLowStockResolvedUpdate(
  product: { status: string; holdReason?: string | null },
  stockLeft: number | null | undefined
) {
  if (
    product.status !== ProductStatus.ON_HOLD ||
    !product.holdReason?.startsWith("Low Amazon stock")
  ) {
    return {};
  }

  if (!isAmazonStockHealthy(stockLeft)) {
    return {};
  }

  return {
    holdReason: LOW_STOCK_RESOLVED_HOLD_REASON,
  };
}
