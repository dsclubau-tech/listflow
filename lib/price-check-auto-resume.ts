import "server-only";

import {
  AmazonPriceTrackingMode,
  EbayActionJobStatus,
  EbayActionJobType,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
  REGULAR_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
  getPriceCheckAutoResumeMetadata,
  isPriceCheckAutoResumeMetadata,
  selectPriceCheckAutoResumeProductIds,
} from "@/lib/price-check-failures";
import {
  LOW_STOCK_RESOLVED_HOLD_REASON,
  LOW_STOCK_THRESHOLD,
} from "@/lib/low-stock-products";

const ACTIVE_ACTION_STATUSES = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
];

type TransactionClient = Prisma.TransactionClient;

type PriceCheckAutoResumeScope = {
  userId: string;
  storeId: string;
  productIds: string[];
  checkedSince: Date;
  all?: boolean;
};

export type PriceCheckAutoResumeQueueResult = {
  actionJobId: string | null;
  queued: number;
};

async function resolveCandidateIds(
  tx: TransactionClient,
  input: Omit<PriceCheckAutoResumeScope, "userId">,
) {
  if (!input.all && input.productIds.length === 0) {
    return [];
  }

  const products = await tx.product.findMany({
    where: {
      ...(input.all ? {} : { id: { in: input.productIds } }),
      storeId: input.storeId,
      status: ProductStatus.ON_HOLD,
      ebayItemId: { not: null },
      priceCheckError: null,
      priceCheckFailureCode: null,
      lastPriceCheck: { gte: input.checkedSince },
      OR: [
        {
          amazonPriceTrackingMode: AmazonPriceTrackingMode.DEAL,
          holdReason: DEAL_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
        },
        {
          amazonPriceTrackingMode: AmazonPriceTrackingMode.REGULAR,
          holdReason: REGULAR_PRICE_UNAVAILABLE_AUTO_HOLD_REASON,
          OR: [
            { amazonStockLeft: null },
            { amazonStockLeft: { gt: LOW_STOCK_THRESHOLD } },
          ],
        },
        {
          holdReason: LOW_STOCK_RESOLVED_HOLD_REASON,
          OR: [
            { amazonStockLeft: null },
            { amazonStockLeft: { gt: LOW_STOCK_THRESHOLD } },
          ],
        },
      ],
    },
    select: {
      id: true,
      status: true,
      ebayItemId: true,
      amazonPriceTrackingMode: true,
      amazonPrice: true,
      holdReason: true,
      priceCheckError: true,
      priceCheckFailureCode: true,
      amazonStockLeft: true,
    },
  });
  const candidateIds = selectPriceCheckAutoResumeProductIds({ products });

  if (candidateIds.length === 0) {
    return [];
  }

  const laterOrActiveActions = await tx.ebayActionJob.findMany({
    where: {
      storeId: input.storeId,
      type: { in: [EbayActionJobType.HOLD, EbayActionJobType.RESUME] },
      productIds: { hasSome: candidateIds },
      OR: [
        { status: { in: ACTIVE_ACTION_STATUSES } },
        { createdAt: { gte: input.checkedSince } },
      ],
    },
    select: { productIds: true },
  });

  return selectPriceCheckAutoResumeProductIds({
    products,
    coveredProductIds: laterOrActiveActions.flatMap((job) => job.productIds),
  });
}

async function createAutoResumeAction(
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
      type: EbayActionJobType.RESUME,
      status: EbayActionJobStatus.QUEUED,
      productIds: input.productIds,
      total: input.productIds.length,
      metadata: getPriceCheckAutoResumeMetadata(
        input.sourcePriceCheckJobId
          ? { sourcePriceCheckJobId: input.sourcePriceCheckJobId }
          : { source: "direct-price-check" },
      ),
    },
  });
}

function reportQueuedResumes(
  result: PriceCheckAutoResumeQueueResult,
  context: { storeId: string; sourcePriceCheckJobId?: string },
) {
  if (result.queued === 0) {
    return;
  }

  invalidateJobCaches(context.storeId);
  logger.info(
    "price-check/auto-resume",
    "Queued automatic resumes after recovered Amazon price or stock checks",
    {
      storeId: context.storeId,
      sourcePriceCheckJobId: context.sourcePriceCheckJobId ?? null,
      actionJobId: result.actionJobId,
      queued: result.queued,
    },
  );
}

export async function finalizePriceCheckAutoResumeForJob(
  priceCheckJobId: string,
): Promise<PriceCheckAutoResumeQueueResult> {
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.priceCheckJob.findUnique({
      where: { id: priceCheckJobId },
      select: {
        id: true,
        userId: true,
        storeId: true,
        productIds: true,
        startedAt: true,
      },
    });

    if (!job?.storeId || !job.startedAt) {
      return { actionJobId: null, queued: 0 };
    }

    const existingActions = await tx.ebayActionJob.findMany({
      where: {
        storeId: job.storeId,
        type: EbayActionJobType.RESUME,
        createdAt: { gte: job.startedAt },
        ...(job.productIds.length > 0
          ? { productIds: { hasSome: job.productIds } }
          : {}),
      },
      select: { id: true, total: true, metadata: true },
    });
    const existingAction = existingActions.find(
      (action) =>
        isPriceCheckAutoResumeMetadata(action.metadata) &&
        (action.metadata as Record<string, unknown>).sourcePriceCheckJobId ===
          job.id,
    );

    if (existingAction) {
      return {
        actionJobId: existingAction.id,
        queued: existingAction.total,
      };
    }

    const productIds = await resolveCandidateIds(tx, {
      storeId: job.storeId,
      productIds: job.productIds,
      checkedSince: job.startedAt,
    });
    const actionJob = await createAutoResumeAction(tx, {
      userId: job.userId,
      storeId: job.storeId,
      productIds,
      sourcePriceCheckJobId: job.id,
    });

    return {
      actionJobId: actionJob?.id ?? null,
      queued: productIds.length,
    };
  });

  const job = await prisma.priceCheckJob.findUnique({
    where: { id: priceCheckJobId },
    select: { storeId: true },
  });
  if (job?.storeId) {
    reportQueuedResumes(result, {
      storeId: job.storeId,
      sourcePriceCheckJobId: priceCheckJobId,
    });
  }

  return result;
}

export async function queuePriceCheckAutoResumeForRun(
  input: PriceCheckAutoResumeScope,
): Promise<PriceCheckAutoResumeQueueResult> {
  const result = await prisma.$transaction(async (tx) => {
    const productIds = await resolveCandidateIds(tx, input);
    const actionJob = await createAutoResumeAction(tx, {
      userId: input.userId,
      storeId: input.storeId,
      productIds,
    });

    return {
      actionJobId: actionJob?.id ?? null,
      queued: productIds.length,
    };
  });

  reportQueuedResumes(result, { storeId: input.storeId });
  return result;
}
