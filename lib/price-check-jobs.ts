import "server-only";

import {
  PriceCheckJobScope,
  PriceCheckJobStatus,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { invalidateJobCaches } from "@/lib/cache-tags";
import {
  getSelectedPriceCheckSummary,
  isValidAsin,
} from "@/lib/price-check-eligibility";
import {
  getPriceCheckLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";
import {
  runPriceCheck,
  type PriceCheckProgress,
  type PriceCheckResult,
} from "@/lib/price-checker";
import { finalizePriceCheckAutoHoldForJob } from "@/lib/price-check-auto-hold";

const ACTIVE_JOB_STATUSES: PriceCheckJobStatus[] = [
  PriceCheckJobStatus.QUEUED,
  PriceCheckJobStatus.RUNNING,
  PriceCheckJobStatus.CANCELLING,
];

type PriceCheckJobRecord = {
  id: string;
  storeId: string | null;
  status: PriceCheckJobStatus;
  scope: PriceCheckJobScope;
  productIds: string[];
  completedProductIds: string[];
  total: number;
  checked: number;
  changed: number;
  pendingReview: number;
  failed: number;
  skipped: number;
  reason: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  autoHoldActionJobId: string | null;
  autoHoldQueued: number;
};

type CreateJobInput = {
  userId: string;
  storeId: string;
  productIds?: unknown[];
  all?: boolean;
};

type PriceCheckCounters = Pick<
  PriceCheckResult,
  "checked" | "changed" | "pendingReview" | "failed" | "skipped"
>;

type JobCheckpoint = {
  productIdsToCheck: string[];
  completedProductIds: string[];
  baseCounters: PriceCheckCounters;
  total: number;
  inferredFromLastCheck: boolean;
};

function invalidatePriceCheckJobCaches(job: { storeId: string | null }) {
  if (job.storeId) {
    invalidateJobCaches(job.storeId);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected price check job error";
}

function normalizeProductIds(productIds: unknown[] | undefined) {
  if (!Array.isArray(productIds)) {
    return [];
  }

  return Array.from(
    new Set(
      productIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    )
  );
}

function getRemainingProductIds(job: PriceCheckJobRecord) {
  if (job.completedProductIds.length > 0) {
    const completed = new Set(job.completedProductIds);
    return job.productIds.filter((productId) => !completed.has(productId));
  }

  const checked = Math.min(Math.max(job.checked, 0), job.productIds.length);
  return job.productIds.slice(checked);
}

function canResumePriceCheckJob(job: PriceCheckJobRecord) {
  return (
    job.status === PriceCheckJobStatus.CANCELLED &&
    getRemainingProductIds(job).length > 0
  );
}

function uniqueInJobOrder(productIds: string[], productIdSet: Set<string>) {
  return productIds.filter((productId) => productIdSet.has(productId));
}

function getBaseCounters(
  job: PriceCheckJobRecord,
  checkedOverride?: number
): PriceCheckCounters {
  return {
    checked: checkedOverride ?? job.checked,
    changed: job.changed,
    pendingReview: job.pendingReview,
    failed: job.failed,
    skipped: job.skipped,
  };
}

function mergeRunProgress(
  baseCounters: PriceCheckCounters,
  total: number,
  progress: PriceCheckProgress
): PriceCheckProgress {
  return {
    ...progress,
    total,
    checked: baseCounters.checked + progress.checked,
    changed: baseCounters.changed + progress.changed,
    pendingReview: baseCounters.pendingReview + progress.pendingReview,
    failed: baseCounters.failed + progress.failed,
    skipped: baseCounters.skipped + progress.skipped,
  };
}

function mergeRunResult(
  baseCounters: PriceCheckCounters,
  result: PriceCheckResult
): PriceCheckResult {
  return {
    ...result,
    checked: baseCounters.checked + result.checked,
    changed: baseCounters.changed + result.changed,
    pendingReview: baseCounters.pendingReview + result.pendingReview,
    failed: baseCounters.failed + result.failed,
    skipped: baseCounters.skipped + result.skipped,
  };
}

export function serializePriceCheckJob(job: PriceCheckJobRecord) {
  const remaining = getRemainingProductIds(job);

  return {
    id: job.id,
    status: job.status,
    scope: job.scope,
    total: job.total,
    checked: job.checked,
    changed: job.changed,
    pendingReview: job.pendingReview,
    failed: job.failed,
    skipped: job.skipped,
    remaining: remaining.length,
    canResume: canResumePriceCheckJob(job),
    reason: job.reason,
    errorMessage: job.errorMessage,
    autoHoldActionJobId: job.autoHoldActionJobId,
    autoHoldQueued: job.autoHoldQueued,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function finalizeAutoHoldsSafely(jobId: string) {
  try {
    const result = await finalizePriceCheckAutoHoldForJob(jobId);
    return { ...result, errorMessage: null as string | null };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(
      "price-check/jobs",
      "Failed to queue automatic holds after price check",
      error,
      { jobId },
    );
    return { actionJobId: null, queued: 0, errorMessage };
  }
}

async function resolveJobCheckpoint(job: PriceCheckJobRecord): Promise<JobCheckpoint> {
  const total = job.total || job.productIds.length;

  if (job.completedProductIds.length > 0) {
    const completed = new Set(job.completedProductIds);
    return {
      productIdsToCheck: job.productIds.filter((productId) => !completed.has(productId)),
      completedProductIds: uniqueInJobOrder(job.productIds, completed),
      baseCounters: getBaseCounters(job),
      total,
      inferredFromLastCheck: false,
    };
  }

  if (job.startedAt) {
    const checkedProducts = await prisma.product.findMany({
      where: {
        id: { in: job.productIds },
        ...(job.storeId ? { storeId: job.storeId } : {}),
        lastPriceCheck: { gte: job.startedAt },
      },
      select: { id: true },
    });
    const checkedProductIds = new Set(checkedProducts.map((product) => product.id));

    if (checkedProductIds.size > job.checked) {
      const completedProductIds = uniqueInJobOrder(job.productIds, checkedProductIds);
      const completed = new Set(completedProductIds);
      return {
        productIdsToCheck: job.productIds.filter((productId) => !completed.has(productId)),
        completedProductIds,
        baseCounters: getBaseCounters(job, completedProductIds.length),
        total,
        inferredFromLastCheck: true,
      };
    }
  }

  const checked = Math.min(Math.max(job.checked, 0), job.productIds.length);
  const completedProductIds = job.productIds.slice(0, checked);
  const completed = new Set(completedProductIds);

  return {
    productIdsToCheck: job.productIds.filter((productId) => !completed.has(productId)),
    completedProductIds,
    baseCounters: getBaseCounters(job, checked),
    total,
    inferredFromLastCheck: false,
  };
}

async function persistCheckpoint(job: PriceCheckJobRecord, checkpoint: JobCheckpoint) {
  if (
    checkpoint.completedProductIds.length <= job.completedProductIds.length &&
    checkpoint.baseCounters.checked <= job.checked &&
    checkpoint.total === job.total
  ) {
    return;
  }

  await prisma.priceCheckJob.update({
    where: { id: job.id },
    data: {
      total: checkpoint.total,
      checked: checkpoint.baseCounters.checked,
      completedProductIds: { set: checkpoint.completedProductIds },
      ...(checkpoint.inferredFromLastCheck
        ? { reason: "Recovered from last known checked products." }
        : {}),
    },
  });
}

async function findActivePriceCheckJob(storeId: string) {
  return prisma.priceCheckJob.findFirst({
    where: {
      storeId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findNextRunnablePriceCheckJob(storeId: string) {
  return prisma.priceCheckJob.findFirst({
    where: {
      storeId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

async function findRunnablePriceCheckJobs(storeId: string) {
  return prisma.priceCheckJob.findMany({
    where: {
      storeId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
}

async function markJobProductCompleted(
  jobId: string,
  productId: string,
  progress: PriceCheckProgress
) {
  await prisma.priceCheckJob.updateMany({
    where: {
      id: jobId,
      NOT: {
        completedProductIds: { has: productId },
      },
    },
    data: {
      total: progress.total,
      checked: progress.checked,
      changed: progress.changed,
      pendingReview: progress.pendingReview,
      failed: progress.failed,
      skipped: progress.skipped,
      reason: progress.reason ?? null,
      completedProductIds: { push: productId },
    },
  });
}

async function resolvePriceCheckSelection(storeId: string, productIds: string[]) {
  const restrictToIds = productIds.length > 0;
  const requestedOrder = new Map(productIds.map((id, index) => [id, index]));

  if (restrictToIds) {
    const products = await prisma.product.findMany({
      where: {
        storeId,
        id: { in: productIds },
      },
      select: {
        id: true,
        status: true,
        asin: true,
        _count: { select: { variants: true } },
      },
    });
    const orderedProducts = products.sort(
      (left, right) =>
        (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
    const selection = getSelectedPriceCheckSummary(
      orderedProducts,
      orderedProducts.map((product) => product.id)
    );

    return {
      productIds: selection.eligibleIds,
      emptyReason:
        selection.selectedCount === 0
          ? "Selected product no longer exists."
          : selection.message,
    };
  }

  const products = await prisma.product.findMany({
    where: {
      storeId,
      status: {
        in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD],
      },
      asin: { not: null },
    },
    select: {
      id: true,
      asin: true,
      _count: { select: { variants: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const eligible = products.filter(
    (product) => isValidAsin(product.asin) && product._count.variants > 0,
  );

  return {
    productIds: eligible.map((product) => product.id),
    emptyReason: "No eligible tracked products found.",
  };
}

async function updateJobProgress(jobId: string, progress: PriceCheckResult & { total: number }) {
  await prisma.priceCheckJob.update({
    where: { id: jobId },
    data: {
      total: progress.total,
      checked: progress.checked,
      changed: progress.changed,
      pendingReview: progress.pendingReview,
      failed: progress.failed,
      skipped: progress.skipped,
      reason: progress.reason ?? null,
    },
  });
}

async function shouldCancelPriceCheckJob(jobId: string) {
  const job = await prisma.priceCheckJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  return (
    job?.status === PriceCheckJobStatus.CANCELLING ||
    job?.status === PriceCheckJobStatus.CANCELLED
  );
}

async function markPriceCheckJobCancelled(
  jobId: string,
  result?: PriceCheckResult
) {
  const autoHold = await finalizeAutoHoldsSafely(jobId);
  const job = await prisma.priceCheckJob.update({
    where: { id: jobId },
    data: {
      status: PriceCheckJobStatus.CANCELLED,
      ...(result
        ? {
            checked: result.checked,
            changed: result.changed,
            pendingReview: result.pendingReview,
            failed: result.failed,
            skipped: result.skipped,
          }
        : {}),
      reason: autoHold.errorMessage
        ? `Price check cancelled. Automatic holds could not be queued: ${autoHold.errorMessage}`
        : "Price check cancelled.",
      errorMessage: null,
      completedAt: new Date(),
    },
  });

  invalidatePriceCheckJobCaches(job);

  return serializePriceCheckJob(job);
}

async function runPriceCheckJobClaimed(jobId: string) {
  const job = await prisma.priceCheckJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) {
    return;
  }

  if (job.status === PriceCheckJobStatus.CANCELLING) {
    await markPriceCheckJobCancelled(job.id);
    return;
  }

  const checkpoint = await resolveJobCheckpoint(job);
  await persistCheckpoint(job, checkpoint);

  if (job.productIds.length === 0 || checkpoint.productIdsToCheck.length === 0) {
    const autoHold = await finalizeAutoHoldsSafely(job.id);
    const completedJob = await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.COMPLETED,
        total: checkpoint.total,
        checked: checkpoint.baseCounters.checked,
        completedAt: new Date(),
        reason:
          autoHold.errorMessage
            ? `Automatic holds could not be queued: ${autoHold.errorMessage}`
            : job.productIds.length === 0
              ? job.reason ?? "No eligible tracked products found."
              : "No remaining products to check.",
      },
    });
    invalidatePriceCheckJobCaches(completedJob);
    return;
  }

  const started = await prisma.priceCheckJob.updateMany({
    where: {
      id: job.id,
      status: {
        in: [PriceCheckJobStatus.QUEUED, PriceCheckJobStatus.RUNNING],
      },
    },
    data: {
      status: PriceCheckJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  if (started.count === 0) {
    if (await shouldCancelPriceCheckJob(job.id)) {
      await markPriceCheckJobCancelled(job.id);
    }

    return;
  }

  try {
    const result = await runPriceCheck({
      storeId: job.storeId ?? undefined,
      productIds: checkpoint.productIdsToCheck,
      ignoreSchedule: true,
      onProgress: (progress) =>
        updateJobProgress(
          job.id,
          mergeRunProgress(checkpoint.baseCounters, checkpoint.total, progress)
        ),
      onProductComplete: (productId, progress) =>
        markJobProductCompleted(
          job.id,
          productId,
          mergeRunProgress(checkpoint.baseCounters, checkpoint.total, progress)
        ),
      shouldCancel: () => shouldCancelPriceCheckJob(job.id),
    });
    const aggregateResult = mergeRunResult(checkpoint.baseCounters, result);

    if (result.cancelled || (await shouldCancelPriceCheckJob(job.id))) {
      await markPriceCheckJobCancelled(job.id, aggregateResult);
      logger.info("price-check/jobs", "Price check job cancelled", {
        jobId: job.id,
        result: aggregateResult,
      });
      return;
    }

    const autoHold = await finalizeAutoHoldsSafely(job.id);
    const completedJob = await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.COMPLETED,
        total: checkpoint.total,
        checked: aggregateResult.checked,
        changed: aggregateResult.changed,
        pendingReview: aggregateResult.pendingReview,
        failed: aggregateResult.failed,
        skipped: aggregateResult.skipped,
        reason:
          autoHold.errorMessage
            ? `Automatic holds could not be queued: ${autoHold.errorMessage}`
            : aggregateResult.reason ?? null,
        completedAt: new Date(),
      },
    });
    invalidatePriceCheckJobCaches(completedJob);

    logger.info("price-check/jobs", "Price check job completed", {
      jobId: job.id,
      result: aggregateResult,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const shouldMarkCancelled = await shouldCancelPriceCheckJob(job.id);

    if (shouldMarkCancelled) {
      await markPriceCheckJobCancelled(job.id);
      logger.info("price-check/jobs", "Price check job cancelled after error", {
        jobId: job.id,
        errorMessage,
      });
      return;
    }

    const autoHold = await finalizeAutoHoldsSafely(job.id);
    const failedJob = await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.FAILED,
        errorMessage: autoHold.errorMessage
          ? `${errorMessage} Automatic holds could not be queued: ${autoHold.errorMessage}`
          : errorMessage,
        completedAt: new Date(),
      },
    });
    invalidatePriceCheckJobCaches(failedJob);

    logger.error("price-check/jobs", "Price check job failed", error, { jobId: job.id });
  }
}

export async function runPriceCheckJob(jobId: string, worker?: WorkerContext) {
  if (!worker) {
    await runPriceCheckJobClaimed(jobId);
    return;
  }

  const job = await prisma.priceCheckJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) {
    return;
  }

  const leaseInput = getPriceCheckLeaseInput(job, worker);

  if (!leaseInput) {
    await runPriceCheckJobClaimed(job.id);
    return;
  }

  await withJobLeases(leaseInput, () => runPriceCheckJobClaimed(job.id));
}

export async function cancelPriceCheckJob(jobId: string, storeId: string) {
  const job = await prisma.priceCheckJob.findFirst({
    where: { id: jobId, storeId },
  });

  if (!job) {
    return null;
  }

  if (job.status === PriceCheckJobStatus.QUEUED) {
    return markPriceCheckJobCancelled(job.id, {
      checked: job.checked,
      changed: job.changed,
      pendingReview: job.pendingReview,
      failed: job.failed,
      skipped: job.skipped,
      reason: "Price check cancelled.",
      cancelled: true,
    });
  }

  if (job.status === PriceCheckJobStatus.RUNNING) {
    const updated = await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.CANCELLING,
        reason: "Stopping after current product...",
      },
    });

    return serializePriceCheckJob(updated);
  }

  return serializePriceCheckJob(job);
}

export async function createPriceCheckJob(input: CreateJobInput) {
  const requestedProductIds = normalizeProductIds(input.productIds);
  const isSelectedScope = requestedProductIds.length > 0;

  if (!isSelectedScope && !input.all) {
    throw new Error("Either productIds or all=true is required.");
  }

  const scope = isSelectedScope
    ? PriceCheckJobScope.SELECTED
    : PriceCheckJobScope.ALL;
  const selection = await resolvePriceCheckSelection(
    input.storeId,
    requestedProductIds
  );
  const eligibleProductIds = selection.productIds;
  const completedAt = eligibleProductIds.length === 0 ? new Date() : null;
  const reason =
    eligibleProductIds.length === 0
      ? selection.emptyReason
      : null;
  const job = await prisma.priceCheckJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      scope,
      status:
        eligibleProductIds.length > 0
          ? PriceCheckJobStatus.QUEUED
          : PriceCheckJobStatus.COMPLETED,
      productIds: eligibleProductIds,
      total: eligibleProductIds.length,
      reason,
      completedAt,
    },
  });

  return { job: serializePriceCheckJob(job), reused: false };
}

export async function resumePriceCheckJob(
  jobId: string,
  storeId: string,
  userId: string
) {
  const sourceJob = await prisma.priceCheckJob.findFirst({
    where: { id: jobId, storeId },
  });

  if (!sourceJob) {
    return null;
  }

  if (sourceJob.status !== PriceCheckJobStatus.CANCELLED) {
    throw new Error("Only cancelled price check jobs can be resumed.");
  }

  const checkpoint = await resolveJobCheckpoint(sourceJob);
  await persistCheckpoint(sourceJob, checkpoint);
  const sourceJobForResponse = {
    ...sourceJob,
    completedProductIds: checkpoint.completedProductIds,
    total: checkpoint.total,
    checked: checkpoint.baseCounters.checked,
  };
  const remainingProductIds = checkpoint.productIdsToCheck;

  if (remainingProductIds.length === 0) {
    return {
      job: serializePriceCheckJob(sourceJobForResponse),
      sourceJob: serializePriceCheckJob(sourceJobForResponse),
      reused: false,
      resumed: false,
    };
  }

  const selection = await resolvePriceCheckSelection(
    storeId,
    remainingProductIds
  );
  const eligibleProductIds = selection.productIds;

  if (eligibleProductIds.length === 0) {
    return {
      job: serializePriceCheckJob(sourceJobForResponse),
      sourceJob: serializePriceCheckJob(sourceJobForResponse),
      reused: false,
      resumed: false,
    };
  }

  const resumedJob = await prisma.priceCheckJob.create({
    data: {
      userId,
      storeId,
      scope: sourceJob.scope,
      status: PriceCheckJobStatus.QUEUED,
      productIds: eligibleProductIds,
      total: eligibleProductIds.length,
      reason: `Resumed from cancelled price check ${sourceJob.id}.`,
    },
  });

  return {
    job: serializePriceCheckJob(resumedJob),
    sourceJob: serializePriceCheckJob(sourceJobForResponse),
    reused: false,
    resumed: true,
  };
}

export async function getCurrentPriceCheckJob(storeId: string) {
  const job = await findActivePriceCheckJob(storeId);

  return job ? serializePriceCheckJob(job) : null;
}

export async function getPriceCheckJobForStore(jobId: string, storeId: string) {
  const job = await prisma.priceCheckJob.findFirst({
    where: {
      id: jobId,
      storeId,
      dismissedAt: null,
    },
  });

  return job ? serializePriceCheckJob(job) : null;
}

export async function runNextPriceCheckJobForStore(
  storeId: string,
  worker?: WorkerContext
) {
  const jobs = worker
    ? await findRunnablePriceCheckJobs(storeId)
    : await findNextRunnablePriceCheckJob(storeId).then((job) => (job ? [job] : []));

  for (const job of jobs) {
    try {
      await runPriceCheckJob(job.id, worker);
      return true;
    } catch (error) {
      if (error instanceof JobConflictError) {
        continue;
      }

      throw error;
    }
  }

  return false;
}

export async function dismissPriceCheckJob(jobId: string, storeId: string) {
  const terminalStatuses = [
    PriceCheckJobStatus.COMPLETED,
    PriceCheckJobStatus.FAILED,
    PriceCheckJobStatus.CANCELLED,
  ];
  const job = await prisma.priceCheckJob.findFirst({
    where: {
      id: jobId,
      storeId,
      status: { in: terminalStatuses },
    },
  });

  if (!job) {
    return null;
  }

  const updated = await prisma.priceCheckJob.update({
    where: { id: job.id },
    data: { dismissedAt: job.dismissedAt ?? new Date() },
  });

  return serializePriceCheckJob(updated);
}
