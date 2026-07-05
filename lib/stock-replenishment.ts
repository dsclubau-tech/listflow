import "server-only";

import { ProductStatus } from "@/app/generated/prisma/enums";
import { buildReviseInventoryStatusXML } from "@/lib/ebay-xml";
import {
  callEbayReviseInventoryStatus,
  getStoreNumber,
} from "@/lib/ebay";
import { fetchActiveEbayListingInventory } from "@/lib/ebay-import";
import {
  getEbayWriteLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStockReplenishmentCandidates } from "@/lib/stock-replenishment-rules";

const MAX_REPLENISHMENTS_PER_RUN = Math.max(
  1,
  Number.parseInt(process.env.LISTFLOW_STOCK_REPLENISH_MAX_PER_RUN ?? "100", 10),
);

export type StockReplenishmentResult = {
  scannedListings: number;
  trackedProducts: number;
  candidates: number;
  replenished: number;
  failed: number;
  skippedConflict: boolean;
  errors: Array<{
    productId: string;
    ebayItemId: string;
    title: string;
    error: string;
  }>;
};

function emptyResult(skippedConflict = false): StockReplenishmentResult {
  return {
    scannedListings: 0,
    trackedProducts: 0,
    candidates: 0,
    replenished: 0,
    failed: 0,
    skippedConflict,
    errors: [],
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown stock replenish error";
}

async function runStockReplenishmentClaimed(
  storeId: string,
): Promise<StockReplenishmentResult> {
  const storeNumber = await getStoreNumber(storeId);
  const products = await prisma.product.findMany({
    where: {
      storeId,
      status: ProductStatus.IMPORTED,
      ebayItemId: { not: null },
      quantity: { gt: 0 },
    },
    select: {
      id: true,
      title: true,
      ebayItemId: true,
      quantity: true,
      status: true,
      variants: {
        select: { id: true },
        take: 2,
      },
    },
  });

  if (products.length === 0) {
    return emptyResult();
  }

  const listings = await fetchActiveEbayListingInventory(storeNumber);
  const candidates = getStockReplenishmentCandidates(
    products.map((product) => ({
      id: product.id,
      title: product.title,
      ebayItemId: product.ebayItemId,
      quantity: product.quantity,
      status: product.status,
      variantCount: product.variants.length,
    })),
    listings,
  ).slice(0, MAX_REPLENISHMENTS_PER_RUN);

  const result: StockReplenishmentResult = {
    scannedListings: listings.length,
    trackedProducts: products.length,
    candidates: candidates.length,
    replenished: 0,
    failed: 0,
    skippedConflict: false,
    errors: [],
  };

  for (const candidate of candidates) {
    const reviseResult = await callEbayReviseInventoryStatus(
      buildReviseInventoryStatusXML(candidate.ebayItemId, {
        quantity: candidate.targetQuantity,
      }),
      storeNumber,
    );

    if (reviseResult.success) {
      result.replenished += 1;
      await prisma.product.update({
        where: { id: candidate.productId },
        data: { errorMessage: null },
      });
      continue;
    }

    const error =
      reviseResult.errorMessage || "eBay did not accept the stock replenish update";
    result.failed += 1;
    result.errors.push({
      productId: candidate.productId,
      ebayItemId: candidate.ebayItemId,
      title: candidate.title,
      error,
    });
    await prisma.product.update({
      where: { id: candidate.productId },
      data: { errorMessage: error },
    });
  }

  if (result.candidates > 0 || result.failed > 0) {
    logger.info("stock-replenishment/run", "Stock replenish pass finished", {
      storeId,
      ...result,
    });
  }

  return result;
}

export async function runStockReplenishmentForStore(
  storeId: string,
  worker?: WorkerContext,
): Promise<StockReplenishmentResult> {
  if (!worker) {
    return runStockReplenishmentClaimed(storeId);
  }

  const jobId = `stock-replenish:${storeId}:${Date.now()}`;

  try {
    return await withJobLeases(
      getEbayWriteLeaseInput(
        storeId,
        "STOCK_REPLENISH",
        jobId,
        worker,
        "Stock replenish",
      ),
      () => runStockReplenishmentClaimed(storeId),
    );
  } catch (error) {
    if (error instanceof JobConflictError) {
      return emptyResult(true);
    }

    logger.warn("stock-replenishment/run", "Stock replenish pass failed", {
      storeId,
      error: getErrorMessage(error),
    });
    throw error;
  }
}
