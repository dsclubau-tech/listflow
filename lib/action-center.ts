import "server-only";

import {
  EbayActionJobStatus,
  EbayResearchBatchStatus,
  EbayImportJobStatus,
  PriceCheckJobStatus,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeEbayImportJob } from "@/lib/ebay-import-jobs";
import { getCurrentEbayActionJobs } from "@/lib/ebay-action-jobs";
import { getCurrentEbayResearchBatches } from "@/lib/ebay-research";
import { serializePriceCheckJob } from "@/lib/price-check-jobs";
import {
  getWorkerStatusForStore,
  getWorkerStatusesForStore,
  type SerializedWorkerStatus,
} from "@/lib/worker-heartbeat";

const QUEUE_LIMIT = 10;
const RECENT_JOB_LIMIT = 5;
const ACTIVE_PRICE_JOB_STATUSES = [
  PriceCheckJobStatus.QUEUED,
  PriceCheckJobStatus.RUNNING,
  PriceCheckJobStatus.CANCELLING,
] as const;
const ACTIVE_IMPORT_JOB_STATUSES = [
  EbayImportJobStatus.QUEUED,
  EbayImportJobStatus.RUNNING,
] as const;
const ACTIVE_RESEARCH_BATCH_STATUSES = [
  EbayResearchBatchStatus.QUEUED,
  EbayResearchBatchStatus.RUNNING,
  EbayResearchBatchStatus.PAUSING,
  EbayResearchBatchStatus.PAUSED,
] as const;
const ACTIVE_EBAY_ACTION_STATUSES = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
] as const;

function money(value: Prisma.Decimal | number | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function productLinkTitle(title: string) {
  return title.trim() || "(untitled)";
}

export interface ActionCenterProductSummary {
  id: string;
  title: string;
  asin: string | null;
  ebayItemId: string | null;
}

export interface PendingReviewActionItem {
  product: ActionCenterProductSummary;
  priceHistoryId: string;
  pendingCount: number;
  previousPrice: string;
  newPrice: string;
  previousSellPrice: string;
  newSellPrice: string;
  changePercent: number;
  createdAt: string;
}

export interface FailedCheckActionItem {
  product: ActionCenterProductSummary;
  errorMessage: string;
  lastPriceCheck: string | null;
}

export interface LowStockActionItem {
  product: ActionCenterProductSummary;
  amazonStockLeft: number | null;
}

export interface OnHoldActionItem {
  product: ActionCenterProductSummary;
  quantity: number;
}

export interface ActionCenterPriceCheckJob {
  id: string;
  status: `${PriceCheckJobStatus}`;
  scope: string;
  total: number;
  checked: number;
  changed: number;
  pendingReview: number;
  failed: number;
  skipped: number;
  remaining: number;
  canResume: boolean;
  reason: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
}

export interface ActionCenterEbayImportJob {
  id: string;
  storeId: string;
  storeName: string;
  status: `${EbayImportJobStatus}`;
  quantity: number;
  requested: number;
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
}

export interface ActionCenterEbayResearchJob {
  id: string;
  status: string;
  query: string;
  activeCount: number;
  queuePosition: number | null;
}

export interface ActionCenterEbayResearchBatch {
  id: string;
  storeId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
  canPause: boolean;
  canResume: boolean;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  jobs: ActionCenterEbayResearchJob[];
}

export interface ActionCenterEbayActionJob {
  id: string;
  storeId: string;
  type: string;
  status: `${EbayActionJobStatus}`;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
}

export interface ActionCenterData {
  worker: SerializedWorkerStatus;
  workers: SerializedWorkerStatus[];
  summary: {
    pendingReviews: number;
    failedChecks: number;
    lowStock: number;
    onHold: number;
    runningJobs: number;
  };
  queues: {
    pendingReviews: PendingReviewActionItem[];
    failedChecks: FailedCheckActionItem[];
    lowStock: LowStockActionItem[];
    onHold: OnHoldActionItem[];
  };
  jobs: {
    priceChecks: ActionCenterPriceCheckJob[];
    ebayImports: ActionCenterEbayImportJob[];
    ebayResearchBatches: ActionCenterEbayResearchBatch[];
    ebayActions: ActionCenterEbayActionJob[];
  };
}

function serializeProduct(product: {
  id: string;
  title: string;
  asin: string | null;
  ebayItemId: string | null;
}): ActionCenterProductSummary {
  return {
    id: product.id,
    title: productLinkTitle(product.title),
    asin: product.asin,
    ebayItemId: product.ebayItemId,
  };
}

export async function getActionCenterData(storeId: string): Promise<ActionCenterData> {
  const pendingGroups = await prisma.priceHistory.groupBy({
    by: ["productId"],
    where: { appliedAt: null, product: { storeId } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const sortedPendingGroups = pendingGroups
    .filter((group) => group._max.createdAt)
    .sort(
      (left, right) =>
        (right._max.createdAt?.getTime() ?? 0) -
        (left._max.createdAt?.getTime() ?? 0)
    );
  const pendingGroupMap = new Map(
    sortedPendingGroups.map((group) => [group.productId, group])
  );
  const visiblePendingProductIds = sortedPendingGroups
    .slice(0, QUEUE_LIMIT)
    .map((group) => group.productId);

  const [
    visiblePendingHistory,
    failedProducts,
    failedChecksCount,
    lowStockProducts,
    lowStockCount,
    onHoldProducts,
    onHoldCount,
    priceCheckJobs,
    ebayImportJobs,
    ebayActionJobs,
    ebayResearchBatches,
    worker,
    workers,
  ] = await Promise.all([
    visiblePendingProductIds.length > 0
      ? prisma.priceHistory.findMany({
          where: {
            appliedAt: null,
            productId: { in: visiblePendingProductIds },
            product: { storeId },
          },
          orderBy: { createdAt: "desc" },
          include: {
            product: {
              select: {
                id: true,
                title: true,
                asin: true,
                ebayItemId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: {
        status: ProductStatus.IMPORTED,
        storeId,
        asin: { not: null },
        variants: { some: {} },
        priceCheckError: { not: null },
      },
      orderBy: [{ lastPriceCheck: "desc" }, { title: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        title: true,
        asin: true,
        ebayItemId: true,
        priceCheckError: true,
        lastPriceCheck: true,
      },
    }),
    prisma.product.count({
      where: {
        status: ProductStatus.IMPORTED,
        storeId,
        asin: { not: null },
        variants: { some: {} },
        priceCheckError: { not: null },
      },
    }),
    prisma.product.findMany({
      where: {
        status: ProductStatus.IMPORTED,
        storeId,
        asin: { not: null },
        amazonStockLeft: { not: null, lte: 3 },
      },
      orderBy: [{ amazonStockLeft: "asc" }, { title: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        title: true,
        asin: true,
        ebayItemId: true,
        amazonStockLeft: true,
      },
    }),
    prisma.product.count({
      where: {
        status: ProductStatus.IMPORTED,
        storeId,
        asin: { not: null },
        amazonStockLeft: { not: null, lte: 3 },
      },
    }),
    prisma.product.findMany({
      where: { status: ProductStatus.ON_HOLD, storeId },
      orderBy: { updatedAt: "desc" },
      take: QUEUE_LIMIT,
      select: {
        id: true,
        title: true,
        asin: true,
        ebayItemId: true,
        quantity: true,
      },
    }),
    prisma.product.count({ where: { status: ProductStatus.ON_HOLD, storeId } }),
    prisma.priceCheckJob.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
    }),
    prisma.ebayImportJob.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      include: {
        store: { select: { name: true } },
      },
    }),
    getCurrentEbayActionJobs(storeId),
    getCurrentEbayResearchBatches(storeId),
    getWorkerStatusForStore(storeId),
    getWorkerStatusesForStore(storeId),
  ]);

  const visiblePendingByProduct = new Map<string, typeof visiblePendingHistory>();

  for (const history of visiblePendingHistory) {
    const existing = visiblePendingByProduct.get(history.productId) ?? [];
    existing.push(history);
    visiblePendingByProduct.set(history.productId, existing);
  }

  const pendingReviews = visiblePendingProductIds
    .map((productId) => {
      const histories = visiblePendingByProduct.get(productId) ?? [];
      const latest = histories.sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      )[0];

      if (!latest) {
        return null;
      }

      return {
        product: serializeProduct(latest.product),
        priceHistoryId: latest.id,
        pendingCount: pendingGroupMap.get(productId)?._count._all ?? histories.length,
        previousPrice: money(latest.previousPrice) ?? "0.00",
        newPrice: money(latest.newPrice) ?? "0.00",
        previousSellPrice: money(latest.previousSellPrice) ?? "0.00",
        newSellPrice: money(latest.newSellPrice) ?? "0.00",
        changePercent: latest.changePercent,
        createdAt: latest.createdAt.toISOString(),
      };
    })
    .filter((item): item is PendingReviewActionItem => item !== null);

  const activePriceJobs = priceCheckJobs.filter((job) =>
    ACTIVE_PRICE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_PRICE_JOB_STATUSES)[number])
  );
  const activeImportJobs = ebayImportJobs.filter((job) =>
    ACTIVE_IMPORT_JOB_STATUSES.includes(job.status as (typeof ACTIVE_IMPORT_JOB_STATUSES)[number])
  );
  const activeResearchBatches = ebayResearchBatches.filter((batch) =>
    ACTIVE_RESEARCH_BATCH_STATUSES.includes(
      batch.status as (typeof ACTIVE_RESEARCH_BATCH_STATUSES)[number]
    )
  );
  const activeEbayActionJobs = ebayActionJobs.filter((job) =>
    ACTIVE_EBAY_ACTION_STATUSES.includes(
      job.status as (typeof ACTIVE_EBAY_ACTION_STATUSES)[number]
    )
  );

  return {
    worker,
    workers,
    summary: {
      pendingReviews: pendingGroups.length,
      failedChecks: failedChecksCount,
      lowStock: lowStockCount,
      onHold: onHoldCount,
      runningJobs:
        activePriceJobs.length +
        activeImportJobs.length +
        activeResearchBatches.length +
        activeEbayActionJobs.length,
    },
    queues: {
      pendingReviews,
      failedChecks: failedProducts.map((product) => ({
        product: serializeProduct(product),
        errorMessage: product.priceCheckError ?? "Price check failed.",
        lastPriceCheck: iso(product.lastPriceCheck),
      })),
      lowStock: lowStockProducts.map((product) => ({
        product: serializeProduct(product),
        amazonStockLeft: product.amazonStockLeft,
      })),
      onHold: onHoldProducts.map((product) => ({
        product: serializeProduct(product),
        quantity: product.quantity,
      })),
    },
    jobs: {
      priceChecks: priceCheckJobs.map((job) => serializePriceCheckJob(job)),
      ebayImports: ebayImportJobs.map((job) => ({
        ...serializeEbayImportJob(job),
        storeName: job.store.name,
      })),
      ebayResearchBatches,
      ebayActions: ebayActionJobs,
    },
  };
}
