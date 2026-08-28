import "server-only";

import {
  EbayActionJobStatus,
  EbayResearchBatchStatus,
  EbayImportJobStatus,
  PriceCheckJobStatus,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { cacheLife, cacheTag } from "next/cache";
import {
  actionCenterCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
  productsCacheTag,
} from "@/lib/cache-tags";
import { prisma } from "@/lib/prisma";
import { serializeEbayImportJob } from "@/lib/ebay-import-jobs";
import { getCurrentEbayActionJobs } from "@/lib/ebay-action-jobs";
import { getCurrentEbayResearchBatches } from "@/lib/ebay-research";
import { serializePriceCheckJob } from "@/lib/price-check-jobs";
import {
  calculatePendingReviewMetrics,
  getEffectiveListingQuantity,
  getLatestPendingReviewHistory,
  getOnHoldReason,
} from "@/lib/action-center-metrics";
import { getLowStockProductWhere } from "@/lib/low-stock-products";
import {
  getOfflineWorkerStatus,
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
  EbayImportJobStatus.PAUSING,
  EbayImportJobStatus.PAUSED,
  EbayImportJobStatus.CANCELLING,
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
  changeAmount: string;
  profit: string | null;
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
  reason: string;
}

export interface ActionCenterPriceCheckJob {
  id: string;
  status: `${PriceCheckJobStatus}`;
  scope: string;
  trigger?: "MANUAL" | "AUTOMATIC" | string;
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
  autoHoldActionJobId: string | null;
  autoHoldQueued: number;
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
  progressPercent: number;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  metadata?: {
    mode?: "QUANTITY" | "SKU";
    skuList?: string[];
    unmatchedSkus?: string[];
    matchedSkuCount?: number;
    selectedListingCount?: number;
    sortField?: "START_DATE";
    sortDirection?: "ASC" | "DESC";
  };
  rateLimited: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
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
  metadata?: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  queuePosition: number | null;
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

type CachedActionCenterQueues = Pick<ActionCenterData, "queues"> & {
  summary: Omit<ActionCenterData["summary"], "runningJobs">;
};

type LiveActionCenterData = Pick<ActionCenterData, "worker" | "workers" | "jobs"> & {
  runningJobs: number;
};

function emptyLiveActionCenterData(message?: string): LiveActionCenterData {
  const worker = getOfflineWorkerStatus(
    message ?? "Live worker and job status is temporarily unavailable."
  );

  return {
    worker,
    workers: [],
    jobs: {
      priceChecks: [],
      ebayImports: [],
      ebayResearchBatches: [],
      ebayActions: [],
    },
    runningJobs: 0,
  };
}

async function getCachedActionCenterQueues(
  storeId: string,
): Promise<CachedActionCenterQueues> {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(
    actionCenterCacheTag(storeId),
    productsCacheTag(storeId),
  );

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

  const visiblePendingHistory =
    visiblePendingProductIds.length > 0
      ? await prisma.priceHistory.findMany({
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
                promotedAdStatus: true,
                promotedAdPercent: true,
              },
            },
            variant: {
              select: {
                feesPercent: true,
                feesFixed: true,
              },
            },
          },
        })
      : [];
  const failedWhere = {
    status: ProductStatus.IMPORTED,
    storeId,
    asin: { not: null },
    variants: { some: {} },
    priceCheckError: { not: null },
  } satisfies Prisma.ProductWhereInput;
  const failedProducts = await prisma.product.findMany({
    where: failedWhere,
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
  });
  const failedChecksCount = await prisma.product.count({ where: failedWhere });
  const lowStockWhere = getLowStockProductWhere(storeId);
  const lowStockProducts = await prisma.product.findMany({
    where: lowStockWhere,
    orderBy: [{ amazonStockLeft: "asc" }, { title: "asc" }],
    take: QUEUE_LIMIT,
    select: {
      id: true,
      title: true,
      asin: true,
      ebayItemId: true,
      amazonStockLeft: true,
    },
  });
  const lowStockCount = await prisma.product.count({ where: lowStockWhere });
  const onHoldWhere = {
    status: ProductStatus.ON_HOLD,
    storeId,
  } satisfies Prisma.ProductWhereInput;
  const onHoldProducts = await prisma.product.findMany({
    where: onHoldWhere,
    orderBy: { updatedAt: "desc" },
    take: QUEUE_LIMIT,
    select: {
      id: true,
      title: true,
      asin: true,
      ebayItemId: true,
      status: true,
      quantity: true,
      amazonStockLeft: true,
      priceCheckError: true,
      holdReason: true,
    },
  });
  const onHoldCount = await prisma.product.count({ where: onHoldWhere });

  const visiblePendingByProduct = new Map<string, typeof visiblePendingHistory>();

  for (const history of visiblePendingHistory) {
    const existing = visiblePendingByProduct.get(history.productId) ?? [];
    existing.push(history);
    visiblePendingByProduct.set(history.productId, existing);
  }

  const pendingReviews = visiblePendingProductIds
    .map((productId) => {
      const histories = visiblePendingByProduct.get(productId) ?? [];
      const latest = getLatestPendingReviewHistory(histories);

      if (!latest) {
        return null;
      }

      const metrics = calculatePendingReviewMetrics({
        previousBuyPrice: Number(latest.previousPrice),
        newBuyPrice: Number(latest.newPrice),
        newSellPrice: Number(latest.newSellPrice),
        feesPercent: latest.variant?.feesPercent ?? null,
        feesFixed: latest.variant?.feesFixed ?? null,
        promotedAdStatus: latest.product.promotedAdStatus,
        promotedAdPercent: latest.product.promotedAdPercent,
      });

      return {
        product: serializeProduct(latest.product),
        priceHistoryId: latest.id,
        pendingCount: pendingGroupMap.get(productId)?._count._all ?? histories.length,
        previousPrice: money(latest.previousPrice) ?? "0.00",
        newPrice: money(latest.newPrice) ?? "0.00",
        previousSellPrice: money(latest.previousSellPrice) ?? "0.00",
        newSellPrice: money(latest.newSellPrice) ?? "0.00",
        changeAmount: metrics.changeAmount.toFixed(2),
        profit: metrics.profit === null ? null : metrics.profit.toFixed(2),
        createdAt: latest.createdAt.toISOString(),
      };
    })
    .filter((item): item is PendingReviewActionItem => item !== null);

  return {
    summary: {
      pendingReviews: pendingGroups.length,
      failedChecks: failedChecksCount,
      lowStock: lowStockCount,
      onHold: onHoldCount,
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
        quantity: getEffectiveListingQuantity(product.status, product.quantity),
        reason: getOnHoldReason({
          holdReason: product.holdReason,
          priceCheckError: product.priceCheckError,
          amazonStockLeft: product.amazonStockLeft,
          savedQuantity: product.quantity,
        }),
      })),
    },
  };
}

async function getLiveActionCenterData(
  storeId: string,
): Promise<LiveActionCenterData> {
  const priceCheckJobs = await prisma.priceCheckJob.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: RECENT_JOB_LIMIT,
  });
  const ebayImportJobs = await prisma.ebayImportJob.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: RECENT_JOB_LIMIT,
    include: {
      store: { select: { name: true } },
    },
  });
  const ebayActionJobs = await getCurrentEbayActionJobs(storeId);
  const ebayResearchBatches = await getCurrentEbayResearchBatches(storeId);
  const workers = await getWorkerStatusesForStore(storeId);
  const worker =
    workers.find((item) => item.online) ?? workers[0] ?? getOfflineWorkerStatus();

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
    jobs: {
      priceChecks: priceCheckJobs.map((job) => serializePriceCheckJob(job)),
      ebayImports: ebayImportJobs.map((job) => ({
        ...serializeEbayImportJob(job),
        storeName: job.store.name,
      })),
      ebayResearchBatches,
      ebayActions: ebayActionJobs,
    },
    runningJobs:
      activePriceJobs.length +
      activeImportJobs.length +
      activeResearchBatches.length +
      activeEbayActionJobs.length,
  };
}

export async function getActionCenterData(storeId: string): Promise<ActionCenterData> {
  const cached = await getCachedActionCenterQueues(storeId);
  let live: LiveActionCenterData;

  try {
    live = await getLiveActionCenterData(storeId);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("max clients")
        ? "Live job status is temporarily unavailable because the database pool is busy."
        : undefined;

    live = emptyLiveActionCenterData(message);
  }

  return {
    worker: live.worker,
    workers: live.workers,
    summary: {
      ...cached.summary,
      runningJobs: live.runningJobs,
    },
    queues: cached.queues,
    jobs: live.jobs,
  };
}
