import "server-only";

import {
  EbayActionJobStatus,
  EbayActionJobType,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AUTO_HOLD_PRICE_CHECK_FAILURE_CODES,
  selectPriceCheckAutoHoldProductIds,
} from "@/lib/price-check-failures";
import { invalidateJobCaches } from "@/lib/cache-tags";

const SUPPLIER_NAME = "Amazon AU";
const ACTIVE_HOLD_STATUSES = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
];

type TransactionClient = Prisma.TransactionClient;

export type PriceCheckAutoHoldQueueResult = {
  actionJobId: string | null;
  queued: number;
};

async function getAutoHoldEnabled(tx: TransactionClient, storeId: string) {
  const settings = await tx.supplierSettings.findUnique({
    where: {
      storeId_supplierName: {
        storeId,
        supplierName: SUPPLIER_NAME,
      },
    },
    select: { autoHoldOnPriceCheckFailure: true },
  });

  return settings?.autoHoldOnPriceCheckFailure ?? true;
}

async function resolveCandidateIds(
  tx: TransactionClient,
  input: {
    storeId: string;
    productIds: string[];
    failedSince: Date;
    all?: boolean;
  },
) {
  const enabled = await getAutoHoldEnabled(tx, input.storeId);

  if (!enabled || (!input.all && input.productIds.length === 0)) {
    return [];
  }

  const products = await tx.product.findMany({
    where: {
      ...(input.all ? {} : { id: { in: input.productIds } }),
      storeId: input.storeId,
      lastPriceCheck: { gte: input.failedSince },
      priceCheckFailureCode: {
        in: [...AUTO_HOLD_PRICE_CHECK_FAILURE_CODES],
      },
    },
    select: {
      id: true,
      status: true,
      ebayItemId: true,
      priceCheckError: true,
      priceCheckFailureCode: true,
    },
  });
  const candidateIds = selectPriceCheckAutoHoldProductIds({
    enabled,
    products,
  });

  if (candidateIds.length === 0) {
    return [];
  }

  const activeHolds = await tx.ebayActionJob.findMany({
    where: {
      storeId: input.storeId,
      type: EbayActionJobType.HOLD,
      status: { in: ACTIVE_HOLD_STATUSES },
      productIds: { hasSome: candidateIds },
    },
    select: { productIds: true },
  });
  const coveredProductIds = activeHolds.flatMap((job) => job.productIds);

  return selectPriceCheckAutoHoldProductIds({
    enabled,
    products,
    coveredProductIds,
  });
}

async function createAutoHoldAction(
  tx: TransactionClient,
  input: {
    userId: string;
    storeId: string;
    productIds: string[];
    sourcePriceCheckJobId?: string;
  },
) {
  if (input.productIds.length === 0) {
    return null;
  }

  return tx.ebayActionJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      type: EbayActionJobType.HOLD,
      status: EbayActionJobStatus.QUEUED,
      productIds: input.productIds,
      total: input.productIds.length,
      metadata: {
        kind: "price-check-auto-hold",
        ...(input.sourcePriceCheckJobId
          ? { sourcePriceCheckJobId: input.sourcePriceCheckJobId }
          : { source: "direct-price-check" }),
      },
    },
  });
}

export async function finalizePriceCheckAutoHoldForJob(
  priceCheckJobId: string,
): Promise<PriceCheckAutoHoldQueueResult> {
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.priceCheckJob.findUnique({
      where: { id: priceCheckJobId },
    });

    if (!job?.storeId || !job.startedAt) {
      return { actionJobId: null, queued: 0 };
    }

    if (job.autoHoldActionJobId) {
      return {
        actionJobId: job.autoHoldActionJobId,
        queued: job.autoHoldQueued,
      };
    }

    const productIds = await resolveCandidateIds(tx, {
      storeId: job.storeId,
      productIds: job.productIds,
      failedSince: job.startedAt,
    });
    const actionJob = await createAutoHoldAction(tx, {
      userId: job.userId,
      storeId: job.storeId,
      productIds,
      sourcePriceCheckJobId: job.id,
    });

    await tx.priceCheckJob.update({
      where: { id: job.id },
      data: {
        autoHoldActionJobId: actionJob?.id ?? null,
        autoHoldQueued: productIds.length,
      },
    });

    return {
      actionJobId: actionJob?.id ?? null,
      queued: productIds.length,
    };
  });

  if (result.queued > 0) {
    const job = await prisma.priceCheckJob.findUnique({
      where: { id: priceCheckJobId },
      select: { storeId: true },
    });
    if (job?.storeId) {
      invalidateJobCaches(job.storeId);
    }
  }

  return result;
}

export async function queuePriceCheckAutoHoldForRun(input: {
  userId: string;
  storeId: string;
  productIds: string[];
  failedSince: Date;
  all?: boolean;
}): Promise<PriceCheckAutoHoldQueueResult> {
  const result = await prisma.$transaction(async (tx) => {
    const productIds = await resolveCandidateIds(tx, input);
    const actionJob = await createAutoHoldAction(tx, {
      userId: input.userId,
      storeId: input.storeId,
      productIds,
    });

    return {
      actionJobId: actionJob?.id ?? null,
      queued: productIds.length,
    };
  });

  if (result.queued > 0) {
    invalidateJobCaches(input.storeId);
  }

  return result;
}
