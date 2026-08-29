import { logger } from "@/lib/logger";
import { getStoreNumber } from "@/lib/ebay";
import {
  fetchActiveEbayListingInventory,
  type EbayListingInventorySnapshot,
} from "@/lib/ebay-import";
import { invalidatePriceCaches } from "@/lib/cache-tags";
import type { WorkerContext } from "@/lib/job-coordination";

export const EBAY_SOLD_COUNT_SYNC_TASK_KEY = "ebay-sold-count-sync";
export const EBAY_SOLD_COUNT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type EbaySoldSyncResult = {
  scannedListings: number;
  totalTracked: number;
  updatedProducts: number;
};

export function getEbaySoldSyncUpdates(
  products: Array<{ id: string; ebayItemId: string | null; quantitySold: number }>,
  listings: EbayListingInventorySnapshot[],
): Array<{ id: string; nextQuantitySold: number }> {
  const soldByEbayItemId = new Map<string, number>();

  for (const listing of listings) {
    soldByEbayItemId.set(listing.itemId, listing.quantitySold);
  }

  const updates: Array<{ id: string; nextQuantitySold: number }> = [];

  for (const product of products) {
    if (!product.ebayItemId) continue;

    const currentEbaySold = soldByEbayItemId.get(product.ebayItemId);
    if (currentEbaySold !== undefined && currentEbaySold !== product.quantitySold) {
      updates.push({
        id: product.id,
        nextQuantitySold: currentEbaySold,
      });
    }
  }

  return updates;
}

export async function syncEbaySoldCountsForStore(
  storeId: string,
  worker?: WorkerContext,
): Promise<EbaySoldSyncResult> {
  const { prisma } = await import("@/lib/prisma");
  const storeNumber = await getStoreNumber(storeId);
  const products = await prisma.product.findMany({
    where: {
      storeId,
      ebayItemId: { not: null },
    },
    select: {
      id: true,
      ebayItemId: true,
      quantitySold: true,
    },
  });

  if (products.length === 0) {
    return {
      scannedListings: 0,
      totalTracked: 0,
      updatedProducts: 0,
    };
  }

  const listings = await fetchActiveEbayListingInventory(storeNumber);
  const updates = getEbaySoldSyncUpdates(products, listings);

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((update) =>
        prisma.product.update({
          where: { id: update.id },
          data: { quantitySold: update.nextQuantitySold },
        }),
      ),
    );

    invalidatePriceCaches(storeId);
  }

  logger.info("ebay/sold-sync", "Completed 24-hour eBay sold count sync", {
    storeId,
    workerId: worker?.workerId,
    scannedListings: listings.length,
    totalTracked: products.length,
    updatedProducts: updates.length,
  });

  return {
    scannedListings: listings.length,
    totalTracked: products.length,
    updatedProducts: updates.length,
  };
}
