import { ProductStatus } from "@/app/generated/prisma/enums";

export const EBAY_REVISE_INVENTORY_STATUS_MAX_ITEMS = 4;

export function chunkInventoryReviseItems<T>(
  items: readonly T[],
  chunkSize = EBAY_REVISE_INVENTORY_STATUS_MAX_ITEMS,
) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("Inventory revise chunk size must be at least 1.");
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export function shouldRetryInventoryBatchIndividually(input: {
  success: boolean;
  itemCount: number;
}) {
  return !input.success && input.itemCount > 1;
}

export function getBulkEditQuantityStatus(input: {
  quantityChanged: boolean;
  quantity: number;
  currentStatus: ProductStatus;
}) {
  if (!input.quantityChanged) {
    return input.currentStatus;
  }

  return input.quantity <= 0 ? ProductStatus.ON_HOLD : ProductStatus.IMPORTED;
}
