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

export type EbayMetricsProductCandidate = {
  id: string;
  ebayItemId: string | null;
  quantitySold: number;
  ebayViewCount?: number | null;
};

export type EbayMetricsProductUpdate = {
  id: string;
  nextQuantitySold: number;
  nextViewCount?: number | null;
};

export function getEbaySoldSyncUpdates(
  products: Array<EbayMetricsProductCandidate>,
  listings: EbayListingInventorySnapshot[],
): Array<EbayMetricsProductUpdate> {
  const listingByEbayItemId = new Map<string, EbayListingInventorySnapshot>();

  for (const listing of listings) {
    listingByEbayItemId.set(listing.itemId, listing);
  }

  const updates: Array<EbayMetricsProductUpdate> = [];

  for (const product of products) {
    if (!product.ebayItemId) continue;

    const currentListing = listingByEbayItemId.get(product.ebayItemId);
    if (!currentListing) continue;

    const soldChanged = currentListing.quantitySold !== product.quantitySold;
    const viewsChanged =
      currentListing.viewCount !== undefined &&
      currentListing.viewCount !== (product.ebayViewCount ?? null);

    if (soldChanged || viewsChanged) {
      updates.push({
        id: product.id,
        nextQuantitySold: currentListing.quantitySold,
        ...(currentListing.viewCount !== undefined
          ? { nextViewCount: currentListing.viewCount }
          : product.ebayViewCount !== undefined
            ? { nextViewCount: product.ebayViewCount }
            : {}),
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
      ebayViewCount: true,
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
          data: {
            quantitySold: update.nextQuantitySold,
            ...(update.nextViewCount !== undefined
              ? { ebayViewCount: update.nextViewCount }
              : {}),
          },
        }),
      ),
    );

    invalidatePriceCaches(storeId);
  }

  logger.info("ebay/sold-sync", "Completed 24-hour eBay sold count and view count sync", {
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
