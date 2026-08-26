type ProductUploadTimestampInput = {
  successfulUploadAt: Date | null | undefined;
  productCreatedAt: Date;
  ebayItemId: string | null | undefined;
  status: string;
};

const LISTED_STATUSES = new Set(["IMPORTED", "ON_HOLD"]);

export function getProductUploadedAt(input: ProductUploadTimestampInput) {
  if (input.successfulUploadAt) {
    return input.successfulUploadAt;
  }

  if (
    LISTED_STATUSES.has(input.status) &&
    Boolean(input.ebayItemId?.trim())
  ) {
    return input.productCreatedAt;
  }

  return null;
}
