export type ProductListingStatus = "in-stock" | "on-hold" | "out-of-stock";

interface ProductListingStatusInput {
  status: string;
  quantity: number;
  amazonStockLeft?: number | null;
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
