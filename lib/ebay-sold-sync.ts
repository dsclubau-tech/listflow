import { randomUUID } from "node:crypto";
import { invalidatePriceCaches } from "@/lib/cache-tags";
import {
  fetchEbayListingViews,
  type EbayListingViewsResult,
} from "@/lib/ebay-analytics";
import { getStoreNumber } from "@/lib/ebay";
import {
  fetchActiveEbayListingInventory,
  type EbayListingInventorySnapshot,
} from "@/lib/ebay-import";
import {
  getEbayMetricsSyncLeaseInput,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import { logger } from "@/lib/logger";

export const EBAY_SOLD_COUNT_SYNC_TASK_KEY = "ebay-sold-count-sync";
export const EBAY_SOLD_COUNT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const EBAY_METRICS_TRANSIENT_RETRY_MS = 15 * 60 * 1000;

export type EbayMetricsSyncStatus =
  | "success"
  | "partial"
  | "failed"
  | "authorization-required";

export type EbayMetricsSectionResult = {
  status: EbayMetricsSyncStatus;
  refreshedProducts: number;
  changedProducts: number;
  unavailableProducts: number;
  failedBatches: number;
  error: string | null;
};

export type EbaySoldSyncResult = {
  scannedListings: number;
  totalTracked: number;
  updatedProducts: number;
  sold: EbayMetricsSectionResult;
  views: EbayMetricsSectionResult;
  reportingStartDate: string | null;
  reportingEndDate: string | null;
  reportingLastUpdatedDate: string | null;
  errors: string[];
  retryAfterMs: number | null;
};

export type EbayMetricsProductCandidate = {
  id: string;
  ebayItemId: string | null;
  quantitySold: number;
  ebayViewCount?: number | null;
};

export type EbaySoldProductUpdate = {
  id: string;
  nextQuantitySold: number;
};

export type EbayViewProductUpdate = {
  id: string;
  nextViewCount: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

export function getEbaySoldSyncUpdates(
  products: Array<EbayMetricsProductCandidate>,
  listings: EbayListingInventorySnapshot[],
): EbaySoldProductUpdate[] {
  const listingByItemId = new Map(listings.map((listing) => [listing.itemId, listing]));
  return products.flatMap((product) => {
    if (!product.ebayItemId) return [];
    const listing = listingByItemId.get(product.ebayItemId);
    if (!listing || listing.quantitySold === product.quantitySold) return [];
    return [{ id: product.id, nextQuantitySold: listing.quantitySold }];
  });
}

export function getEbayViewSyncUpdates(
  products: Array<EbayMetricsProductCandidate>,
  viewsByListingId: ReadonlyMap<string, number>,
): EbayViewProductUpdate[] {
  return products.flatMap((product) => {
    if (!product.ebayItemId || !viewsByListingId.has(product.ebayItemId)) return [];
    const nextViewCount = viewsByListingId.get(product.ebayItemId)!;
    if (nextViewCount === (product.ebayViewCount ?? null)) return [];
    return [{ id: product.id, nextViewCount }];
  });
}

function analyticsStatus(result: EbayListingViewsResult): EbayMetricsSyncStatus {
  if (result.authorizationRequired) return "authorization-required";
  if (result.failedBatches === 0) return "success";
  return result.successfulBatches > 0 ? "partial" : "failed";
}

function makeInvocationWorker(worker?: WorkerContext): WorkerContext {
  return (
    worker ?? {
      workerId: `ebay-metrics-${randomUUID()}`,
      workerName: "Manual eBay metrics sync",
      workerRole: "unified",
    }
  );
}

async function syncEbayMetricsClaimed(
  storeId: string,
  worker?: WorkerContext,
): Promise<EbaySoldSyncResult> {
  const { prisma } = await import("@/lib/prisma");
  const storeNumber = await getStoreNumber(storeId);
  const products = await prisma.product.findMany({
    where: { storeId, ebayItemId: { not: null } },
    select: {
      id: true,
      ebayItemId: true,
      quantitySold: true,
      ebayViewCount: true,
    },
  });

  if (products.length === 0) {
    const emptySection: EbayMetricsSectionResult = {
      status: "success",
      refreshedProducts: 0,
      changedProducts: 0,
      unavailableProducts: 0,
      failedBatches: 0,
      error: null,
    };
    return {
      scannedListings: 0,
      totalTracked: 0,
      updatedProducts: 0,
      sold: emptySection,
      views: { ...emptySection },
      reportingStartDate: null,
      reportingEndDate: null,
      reportingLastUpdatedDate: null,
      errors: [],
      retryAfterMs: null,
    };
  }

  let soldListings: EbayListingInventorySnapshot[] = [];
  let soldError: string | null = null;
  try {
    soldListings = await fetchActiveEbayListingInventory(storeNumber);
  } catch (error) {
    soldError = errorMessage(error);
  }

  const listingIds = products
    .map((product) => product.ebayItemId)
    .filter((value): value is string => Boolean(value));
  let viewResult: EbayListingViewsResult;
  try {
    viewResult = await fetchEbayListingViews({ storeId, storeNumber, listingIds });
  } catch (error) {
    viewResult = {
      viewsByListingId: new Map(),
      requestedListings: new Set(listingIds).size,
      successfulBatches: 0,
      failedBatches: 1,
      authorizationRequired: false,
      errors: [errorMessage(error)],
      warnings: [],
      startDate: null,
      endDate: null,
      lastUpdatedDate: null,
    };
  }

  const soldUpdates = soldError
    ? []
    : getEbaySoldSyncUpdates(products, soldListings);
  const viewUpdates = getEbayViewSyncUpdates(products, viewResult.viewsByListingId);
  const soldByProductId = new Map(
    soldUpdates.map((update) => [update.id, update.nextQuantitySold]),
  );
  const viewsByProductId = new Map(
    viewUpdates.map((update) => [update.id, update.nextViewCount]),
  );
  const changedProductIds = new Set([
    ...soldByProductId.keys(),
    ...viewsByProductId.keys(),
  ]);

  let updatedProducts = 0;
  if (changedProductIds.size > 0) {
    const productById = new Map(products.map((product) => [product.id, product]));
    const ids = Array.from(changedProductIds);
    try {
      for (let index = 0; index < ids.length; index += 20) {
        const writes = await prisma.$transaction(
          ids.slice(index, index + 20).map((id) => {
            const product = productById.get(id)!;
            return prisma.product.updateMany({
              where: { id, storeId, ebayItemId: product.ebayItemId },
              data: {
                ...(soldByProductId.has(id)
                  ? { quantitySold: soldByProductId.get(id)! }
                  : {}),
                ...(viewsByProductId.has(id)
                  ? { ebayViewCount: viewsByProductId.get(id)! }
                  : {}),
              },
            });
          }),
        );
        updatedProducts += writes.reduce((total, write) => total + write.count, 0);
      }
    } finally {
      if (updatedProducts > 0) invalidatePriceCaches(storeId);
    }
  }

  const soldListingIds = new Set(soldListings.map((listing) => listing.itemId));
  const refreshedSoldProducts = products.filter(
    (product) => Boolean(product.ebayItemId) && soldListingIds.has(product.ebayItemId!),
  ).length;
  const refreshedViewProducts = products.filter(
    (product) =>
      Boolean(product.ebayItemId) &&
      viewResult.viewsByListingId.has(product.ebayItemId!),
  ).length;
  const errors = [
    ...(soldError ? [`Sold counts: ${soldError}`] : []),
    ...viewResult.errors.map((message) => `Views: ${message}`),
  ];
  const transientFailure =
    Boolean(soldError) ||
    (viewResult.failedBatches > 0 && !viewResult.authorizationRequired);
  const result: EbaySoldSyncResult = {
    scannedListings: soldListings.length,
    totalTracked: products.length,
    updatedProducts,
    sold: {
      status: soldError ? "failed" : "success",
      refreshedProducts: soldError ? 0 : refreshedSoldProducts,
      changedProducts: soldUpdates.length,
      unavailableProducts: soldError
        ? products.length
        : Math.max(0, products.length - refreshedSoldProducts),
      failedBatches: soldError ? 1 : 0,
      error: soldError,
    },
    views: {
      status: analyticsStatus(viewResult),
      refreshedProducts: refreshedViewProducts,
      changedProducts: viewUpdates.length,
      unavailableProducts: Math.max(0, products.length - refreshedViewProducts),
      failedBatches: viewResult.failedBatches,
      error: viewResult.errors.join("; ") || null,
    },
    reportingStartDate: viewResult.startDate,
    reportingEndDate: viewResult.endDate,
    reportingLastUpdatedDate: viewResult.lastUpdatedDate,
    errors,
    retryAfterMs: transientFailure ? EBAY_METRICS_TRANSIENT_RETRY_MS : null,
  };

  logger.info("ebay/sold-sync", "Completed daily eBay sold count and view sync", {
    storeId,
    workerId: worker?.workerId,
    ...result,
  });
  return result;
}

export async function syncEbaySoldCountsForStore(
  storeId: string,
  worker?: WorkerContext,
): Promise<EbaySoldSyncResult> {
  const invocationWorker = makeInvocationWorker(worker);
  const jobId = `ebay-metrics-${storeId}-${randomUUID()}`;
  return withJobLeases(
    getEbayMetricsSyncLeaseInput(storeId, jobId, invocationWorker),
    () => syncEbayMetricsClaimed(storeId, worker),
  );
}

export async function syncEbaySoldCountsForAllStores() {
  const { prisma } = await import("@/lib/prisma");
  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const results: Array<{
    storeId: string;
    storeName: string;
    result?: EbaySoldSyncResult;
    error?: string;
  }> = [];

  for (const store of stores) {
    try {
      results.push({
        storeId: store.id,
        storeName: store.name,
        result: await syncEbaySoldCountsForStore(store.id),
      });
    } catch (error) {
      const message = errorMessage(error);
      results.push({ storeId: store.id, storeName: store.name, error: message });
      logger.warn("ebay/sold-sync", `Failed to sync eBay sold/views for store ${store.id}`, {
        storeId: store.id,
        error: message,
      });
    }
  }

  return {
    storesProcessed: results.filter((entry) => entry.result).length,
    totalScanned: results.reduce(
      (total, entry) => total + (entry.result?.scannedListings ?? 0),
      0,
    ),
    totalTracked: results.reduce(
      (total, entry) => total + (entry.result?.totalTracked ?? 0),
      0,
    ),
    totalUpdated: results.reduce(
      (total, entry) => total + (entry.result?.updatedProducts ?? 0),
      0,
    ),
    results,
  };
}
