export type ProductListingStatus = "in-stock" | "on-hold" | "out-of-stock" | "unavailable";

interface ProductListingStatusInput {
  status: string;
  quantity: number;
  amazonStockLeft?: number | null;
  amazonAvailability?: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN" | string | null;
  priceCheckFailureCode?: string | null;
  variants?: Array<{
    quantity?: number;
    status?: string;
  }>;
}

export function getProductListingStatus(
  product: ProductListingStatusInput,
): ProductListingStatus {
  if (product.status === "ON_HOLD") {
    return "on-hold";
  }

  if (
    product.amazonAvailability === "UNKNOWN" &&
    (product.priceCheckFailureCode === "AMAZON_BUYBOX_UNAVAILABLE" ||
      product.priceCheckFailureCode === "AMAZON_ASIN_REDIRECT")
  ) {
    return "unavailable";
  }

  if (
    product.amazonStockLeft !== null &&
    product.amazonStockLeft !== undefined &&
    product.amazonStockLeft <= 0
  ) {
    return "out-of-stock";
  }

  if (product.variants && product.variants.length > 0) {
    const hasAvailableVariant = product.variants.some(
      (variant) =>
        variant.status !== "OUT_OF_STOCK" &&
        (variant.quantity === undefined || variant.quantity > 0),
    );

    return hasAvailableVariant ? "in-stock" : "out-of-stock";
  }

  return product.quantity > 0 ? "in-stock" : "out-of-stock";
}
