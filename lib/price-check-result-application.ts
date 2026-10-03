import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { acquireOwnedJobLease, JobConflictError, type WorkerContext } from "@/lib/job-coordination";
import { recordListingOperation } from "@/lib/listing-operations";

export class PriceCheckResultDeferred extends Error {
  constructor(message = "Waiting for another marketplace update to finish. Remaining products preserved.") {
    super(message);
  }
}

export class SupersededAmazonObservation extends Error {
  constructor() { super("A newer Amazon observation superseded this check."); }
}

// Scraping is concurrent. Only applying results and issuing marketplace writes
// is serialized, using the same store write lane as existing eBay action jobs.
export async function acquirePriceCheckResultLease(input: {
  storeId: string; productId: string; worker?: WorkerContext;
  assertOwnership?: () => Promise<void>; shouldCancel?: () => boolean | Promise<boolean>;
}) {
  const operationId = randomUUID();
  const worker = input.worker ?? {
    workerId: `result:${operationId}`, workerName: "Price check result", workerRole: "legacy" as const,
  };
  const deadline = Date.now() + 120_000;
  while (true) {
    await input.assertOwnership?.();
    if (await input.shouldCancel?.()) throw new Error("Price check cancelled.");
    try {
      return await acquireOwnedJobLease({
        storeId: input.storeId, jobType: "PRICE_CHECK_RESULT", jobId: operationId, worker,
        gateKey: "ebay-api:gate",
        resources: ["ebay-api-write", `price-check-result:${input.productId}`],
      });
    } catch (error) {
      if (!(error instanceof JobConflictError)) throw error;
      if (Date.now() >= deadline) {
        throw new PriceCheckResultDeferred();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

export async function assertAmazonObservationCurrent(input: {
  storeId: string; productId: string; observedAt: Date;
}) {
  const newer = await prisma.amazonPriceObservation.findFirst({ where: {
    storeId: input.storeId, productId: input.productId,
    observedAt: { gt: input.observedAt }, identityOutcome: "MATCH", postcodeVerified: true,
    OR: [{ isSuccessful: true }, { buyBoxOutcome: "UNAVAILABLE" }, { failureCode: "AMAZON_PRICE_UNAVAILABLE" }],
  } });
  if (newer) throw new SupersededAmazonObservation();
}

export async function runObservedPriceWrite<T extends { success: boolean; errorMessage?: string; outcomeUncertain?: boolean }>(input: {
  storeId: string; productId: string; observedAt: Date; observationKey: string;
  assertOwnership: () => Promise<void>;
}, write: () => Promise<T>): Promise<T> {
  await input.assertOwnership();
  await assertAmazonObservationCurrent(input);
  const uncertain = await prisma.listingOperation.findFirst({ where: {
    productId: input.productId, storeId: input.storeId,
    stage: { in: ["PRICE_SYNC", "RECONCILIATION"] },
    requestKey: { startsWith: "price-observation:" },
  } });
  if (uncertain) throw new Error("A previous eBay price update has an uncertain outcome; reconcile before retry.");
  const jobId = `price-observation:${input.observationKey}`;
  const requestKey = `${jobId}:${input.productId}`;
  await recordListingOperation({ jobId, productId: input.productId, storeId: input.storeId,
    stage: "PRICE_SYNC", preparedPayload: { observedAt: input.observedAt.toISOString() } });
  try {
    await input.assertOwnership();
    const response = await write();
    await recordListingOperation({ jobId, productId: input.productId, storeId: input.storeId,
      stage: response.success ? "COMPLETED" : response.outcomeUncertain ? "RECONCILIATION" : "FAILED",
      confirmed: response.success, error: response.errorMessage });
    return response;
  } catch (error) {
    await prisma.listingOperation.updateMany({ where: { requestKey }, data: {
      stage: "RECONCILIATION", lastError: error instanceof Error ? error.message : String(error),
    } });
    throw error;
  }
}
