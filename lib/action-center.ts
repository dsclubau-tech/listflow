import "server-only";

import {
  EbayActionJobStatus,
  EbayResearchBatchStatus,
  EbayResearchJobStatus,
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
import { getEbayActionQueuePositions } from "@/lib/ebay-action-queue";
import { isEbayResearchBatchResumable } from "@/lib/ebay-research-batch-state";
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
  priceCheckFailureCode?: string | null;
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
  priceCheckFailureCode?: string | null;
}): ActionCenterProductSummary {
  return {
    id: product.id,
    title: productLinkTitle(product.title),
    asin: product.asin,
    ebayItemId: product.ebayItemId,
    priceCheckFailureCode: product.priceCheckFailureCode ?? null,
  };
}

type CachedActionCenterQueues = Pick<ActionCenterData, "queues"> & {
  summary: Omit<ActionCenterData["summary"], "runningJobs">;
};

export type LiveActionCenterData = Pick<ActionCenterData, "worker" | "workers" | "jobs"> & {
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
      priceCheckFailureCode: true,
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

async function loadLiveActionCenterData(
  storeId: string,
): Promise<LiveActionCenterData> {
  const [
    priceCheckJobs,
    ebayImportJobs,
    activeEbayActionJobs,
    recentEbayActionJobs,
    ebayResearchBatches,
  ] = await prisma.$transaction([
    prisma.priceCheckJob.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: {
        id: true,
        status: true,
        scope: true,
        trigger: true,
        total: true,
        checked: true,
        changed: true,
        pendingReview: true,
        failed: true,
        skipped: true,
        reason: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        dismissedAt: true,
        autoHoldActionJobId: true,
        autoHoldQueued: true,
      },
    }),
    prisma.ebayImportJob.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: {
        id: true,
        storeId: true,
        status: true,
        quantity: true,
        requested: true,
        processed: true,
        total: true,
        created: true,
        skipped: true,
        failed: true,
        rateLimited: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        pausedAt: true,
        cancelledAt: true,
        dismissedAt: true,
        store: { select: { name: true } },
      },
    }),
    prisma.ebayActionJob.findMany({
      where: {
        storeId,
        dismissedAt: null,
        status: { in: [...ACTIVE_EBAY_ACTION_STATUSES] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        storeId: true,
        type: true,
        status: true,
        total: true,
        processed: true,
        succeeded: true,
        failed: true,
        metadata: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        dismissedAt: true,
      },
    }),
    prisma.ebayActionJob.findMany({
      where: {
        storeId,
        dismissedAt: null,
        status: { notIn: [...ACTIVE_EBAY_ACTION_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: {
        id: true,
        storeId: true,
        type: true,
        status: true,
        total: true,
        processed: true,
        succeeded: true,
        failed: true,
        metadata: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        dismissedAt: true,
      },
    }),
    prisma.ebayResearchBatch.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        storeId: true,
        status: true,
        total: true,
        completed: true,
        failed: true,
        cooldownUntil: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        pausedAt: true,
        jobs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            query: true,
            activeCount: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);
  const workers = await getWorkerStatusesForStore(storeId);
  const worker =
    workers.find((item) => item.online) ?? workers[0] ?? getOfflineWorkerStatus();

  const serializedPriceCheckJobs = priceCheckJobs.map((job) => {
    const remaining = Math.max(0, job.total - job.checked);
    return {
      ...job,
      status: `${job.status}` as const,
      scope: `${job.scope}`,
      trigger: `${job.trigger}`,
      remaining,
      canResume: job.status === PriceCheckJobStatus.CANCELLED && remaining > 0,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: iso(job.startedAt),
      completedAt: iso(job.completedAt),
      dismissedAt: iso(job.dismissedAt),
    };
  });
  const serializedImportJobs = ebayImportJobs.map((job) => {
    const { store, ...compactJob } = job;
    const progressTotal = job.total || job.requested || job.quantity;
    return {
      ...compactJob,
      storeName: store.name,
      progressPercent:
        progressTotal <= 0
          ? 0
          : Math.min(100, Math.round((job.processed / progressTotal) * 100)),
      canPause:
        job.status === EbayImportJobStatus.QUEUED ||
        job.status === EbayImportJobStatus.RUNNING,
      canResume: job.status === EbayImportJobStatus.PAUSED,
      canCancel: ACTIVE_IMPORT_JOB_STATUSES.includes(
        job.status as (typeof ACTIVE_IMPORT_JOB_STATUSES)[number],
      ),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: iso(job.startedAt),
      completedAt: iso(job.completedAt),
      pausedAt: iso(job.pausedAt),
      cancelledAt: iso(job.cancelledAt),
      dismissedAt: iso(job.dismissedAt),
    };
  });
  const ebayActionJobs = [...activeEbayActionJobs, ...recentEbayActionJobs];
  const actionQueuePositions = getEbayActionQueuePositions(ebayActionJobs);
  const serializedActionJobs = ebayActionJobs.map((job) => ({
    ...job,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    dismissedAt: iso(job.dismissedAt),
    queuePosition: actionQueuePositions.get(job.id) ?? null,
  }));
  const serializedResearchBatches = ebayResearchBatches.map((batch) => {
    const queuedJobs = batch.jobs.filter(
      (job) =>
        job.status === EbayResearchJobStatus.QUEUED ||
        job.status === EbayResearchJobStatus.PAUSED,
    );
    const queuedPositions = new Map(
      queuedJobs.map((job, index) => [job.id, index + 1]),
    );
    return {
      ...batch,
      running: batch.jobs.filter(
        (job) =>
          job.status === EbayResearchJobStatus.RUNNING ||
          job.status === EbayResearchJobStatus.PAUSING,
      ).length,
      queued: batch.jobs.filter((job) => job.status === EbayResearchJobStatus.QUEUED).length,
      paused: batch.jobs.filter((job) => job.status === EbayResearchJobStatus.PAUSED).length,
      canPause:
        batch.status === EbayResearchBatchStatus.QUEUED ||
        batch.status === EbayResearchBatchStatus.RUNNING,
      canResume: isEbayResearchBatchResumable(batch.status),
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
      startedAt: iso(batch.startedAt),
      completedAt: iso(batch.completedAt),
      pausedAt: iso(batch.pausedAt),
      cooldownUntil: iso(batch.cooldownUntil),
      jobs: batch.jobs.map((job) => ({
        id: job.id,
        status: `${job.status}`,
        query: job.query,
        activeCount: job.activeCount,
        queuePosition: queuedPositions.get(job.id) ?? null,
      })),
    };
  });

  const activePriceJobs = serializedPriceCheckJobs.filter((job) =>
    ACTIVE_PRICE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_PRICE_JOB_STATUSES)[number])
  );
  const activeImportJobs = serializedImportJobs.filter((job) =>
    ACTIVE_IMPORT_JOB_STATUSES.includes(job.status as (typeof ACTIVE_IMPORT_JOB_STATUSES)[number])
  );
  const activeResearchBatches = serializedResearchBatches.filter((batch) =>
    ACTIVE_RESEARCH_BATCH_STATUSES.includes(
      batch.status as (typeof ACTIVE_RESEARCH_BATCH_STATUSES)[number]
    )
  );
  const currentEbayActionJobs = serializedActionJobs.filter((job) =>
    ACTIVE_EBAY_ACTION_STATUSES.includes(
      job.status as (typeof ACTIVE_EBAY_ACTION_STATUSES)[number]
    )
  );

  return {
    worker,
    workers,
    jobs: {
      priceChecks: serializedPriceCheckJobs,
      ebayImports: serializedImportJobs,
      ebayResearchBatches: serializedResearchBatches,
      ebayActions: serializedActionJobs,
    },
    runningJobs:
      activePriceJobs.length +
      activeImportJobs.length +
      activeResearchBatches.length +
      currentEbayActionJobs.length,
  };
}

const globalForActionCenter = globalThis as typeof globalThis & {
  listflowActionCenterLiveRequests?: Map<string, Promise<LiveActionCenterData>>;
};

export function getLiveActionCenterData(storeId: string): Promise<LiveActionCenterData> {
  const requests =
    globalForActionCenter.listflowActionCenterLiveRequests ??
    (globalForActionCenter.listflowActionCenterLiveRequests = new Map());
  const existing = requests.get(storeId);
  if (existing) return existing;

  const request = loadLiveActionCenterData(storeId).finally(() => {
    if (requests.get(storeId) === request) {
      requests.delete(storeId);
    }
  });
  requests.set(storeId, request);
  return request;
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
