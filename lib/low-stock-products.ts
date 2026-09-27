import { ProductStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";

export const DEFAULT_MIN_PRODUCT_QUANTITY = 2;
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

export function getMinimumProductQuantity(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MIN_PRODUCT_QUANTITY;
}

export function isAmazonStockLow(stockLeft: number | null | undefined, minimum: number) {
  return typeof stockLeft === "number" && Number.isFinite(stockLeft) &&
    stockLeft >= 0 && stockLeft < getMinimumProductQuantity(minimum);
}

export function getLowStockProductWhere(storeId: string, minimum: number) {
  return {
    storeId,
    status: ProductStatus.IMPORTED,
    asin: { not: null },
    amazonStockLeft: { gte: 0, lt: getMinimumProductQuantity(minimum) },
  } satisfies Prisma.ProductWhereInput;
}

export function isAmazonStockHealthy(stockLeft: number | null | undefined, minimum: number) {
  return (
    stockLeft === null ||
    (typeof stockLeft === "number" && stockLeft >= getMinimumProductQuantity(minimum))
  );
}

export function isResolvedLowStockHoldReason(reason: string | null | undefined) {
  return reason === LOW_STOCK_RESOLVED_HOLD_REASON;
}

export function getLowStockResolvedUpdate(
  product: { status: string; holdReason?: string | null; holdOrigin?: string | null },
  stockLeft: number | null | undefined,
  minimum: number,
) {
  if (
    product.status !== ProductStatus.ON_HOLD ||
    product.holdOrigin === "MANUAL" ||
    !product.holdReason?.startsWith("Low Amazon stock")
  ) {
    return {};
  }

  // A fresh numeric count is required before any low-stock hold can recover.
  if (typeof stockLeft !== "number" || stockLeft < getMinimumProductQuantity(minimum)) {
    return {};
  }
  if (!isAmazonStockHealthy(stockLeft, minimum)) {
    return {};
  }

  return {
    holdReason: LOW_STOCK_RESOLVED_HOLD_REASON,
  };
}
