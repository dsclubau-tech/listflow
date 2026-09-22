import { ProductHoldOrigin, PriceCheckFailureCode } from "@/app/generated/prisma/enums";

export type SavedVariantQuantity = {
  variantId: string;
  sku: string | null;
  quantity: number;
};

export function getProductHoldOrigin(input: {
  automaticPriceCheck?: boolean;
  lowStock?: boolean;
  failureCode?: PriceCheckFailureCode | string | null;
  existing?: ProductHoldOrigin | string | null;
}): ProductHoldOrigin {
  if (input.automaticPriceCheck) {
    switch (input.failureCode) {
      case PriceCheckFailureCode.AMAZON_OUT_OF_STOCK:
        return ProductHoldOrigin.PRICE_CHECK_OUT_OF_STOCK;
      case PriceCheckFailureCode.AMAZON_ASIN_REDIRECT:
      case PriceCheckFailureCode.AMAZON_VARIANT_SELECTION_REQUIRED:
        return ProductHoldOrigin.PRICE_CHECK_IDENTITY;
      case PriceCheckFailureCode.UNSAFE_PRICE_CHANGE:
        return ProductHoldOrigin.PRICE_CHECK_UNSAFE_PRICE;
      case PriceCheckFailureCode.AMAZON_PRICE_UNAVAILABLE:
      case PriceCheckFailureCode.AMAZON_BUYBOX_UNAVAILABLE:
      case PriceCheckFailureCode.MISSING_BASELINE:
      default:
        return ProductHoldOrigin.PRICE_CHECK_PRICE_UNAVAILABLE;
    }
  }

  if (input.lowStock) return ProductHoldOrigin.LOW_STOCK;
  if (input.existing && Object.values(ProductHoldOrigin).includes(input.existing as ProductHoldOrigin)) {
    return input.existing as ProductHoldOrigin;
  }
  return ProductHoldOrigin.MANUAL;
}

export function captureHoldQuantities(input: {
  currentQuantity: number;
  existingSavedQuantity?: number | null;
  variants?: Array<{ id: string; sku?: string | null; quantity: number }>;
  existingSavedVariants?: unknown;
}) {
  const savedQuantity =
    input.existingSavedQuantity !== null && input.existingSavedQuantity !== undefined
      ? Math.max(0, Math.floor(input.existingSavedQuantity))
      : Math.max(0, Math.floor(input.currentQuantity));

  const existing = Array.isArray(input.existingSavedVariants)
    ? input.existingSavedVariants
        .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
        .map((value) => ({
          variantId: String(value.variantId ?? ""),
          sku: typeof value.sku === "string" ? value.sku : null,
          quantity: Math.max(0, Math.floor(Number(value.quantity) || 0)),
        }))
        .filter((value) => value.variantId)
    : [];

  const savedVariants: SavedVariantQuantity[] = existing.length > 0
    ? existing
    : (input.variants ?? []).map((variant) => ({
        variantId: variant.id,
        sku: variant.sku ?? null,
        quantity: Math.max(0, Math.floor(variant.quantity)),
      }));

  return { savedQuantity, savedVariants };
}

export function canAutomaticallyRecoverHold(input: {
  origin?: ProductHoldOrigin | string | null;
  availability?: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN" | null;
  stockLeft?: number | null;
  hasVerifiedPrice: boolean;
  savedQuantity?: number | null;
  identityVerified?: boolean;
}) {
  if (input.origin === ProductHoldOrigin.MANUAL || input.origin === ProductHoldOrigin.UNKNOWN) return false;
  if (input.savedQuantity === null || input.savedQuantity === undefined || input.savedQuantity <= 0) return false;
  if (!input.hasVerifiedPrice) return false;
  if (input.identityVerified === false) return false;
  if (input.availability === "OUT_OF_STOCK" || input.availability === "UNKNOWN") return false;
  if (input.origin === ProductHoldOrigin.LOW_STOCK && (input.stockLeft === null || input.stockLeft === undefined || input.stockLeft <= 3)) return false;
  return true;
}
