import "server-only";

import {
  PriceCheckJobScope,
  PriceCheckJobStatus,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { runPriceCheck, type PriceCheckResult } from "@/lib/price-checker";

const ACTIVE_JOB_STATUSES: PriceCheckJobStatus[] = [
  PriceCheckJobStatus.QUEUED,
  PriceCheckJobStatus.RUNNING,
];

type PriceCheckJobRecord = {
  id: string;
  status: PriceCheckJobStatus;
  scope: PriceCheckJobScope;
  productIds: string[];
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
};

type CreateJobInput = {
  userId: string;
  productIds?: unknown[];
  all?: boolean;
};

const globalForPriceCheckJobs = globalThis as typeof globalThis & {
  listflowPriceCheckJobIds?: Set<string>;
};

function getRunningJobIds() {
  if (!globalForPriceCheckJobs.listflowPriceCheckJobIds) {
    globalForPriceCheckJobs.listflowPriceCheckJobIds = new Set<string>();
  }

  return globalForPriceCheckJobs.listflowPriceCheckJobIds;
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

export function serializePriceCheckJob(job: PriceCheckJobRecord) {
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
    reason: job.reason,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

async function findActivePriceCheckJob(userId: string) {
  return prisma.priceCheckJob.findFirst({
    where: {
      userId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveEligibleProductIds(productIds: string[]) {
  const restrictToIds = productIds.length > 0;
  const requestedOrder = new Map(productIds.map((id, index) => [id, index]));
  const products = await prisma.product.findMany({
    where: {
      status: ProductStatus.IMPORTED,
      asin: { not: null },
      ...(restrictToIds ? { id: { in: productIds } } : {}),
    },
    select: {
      id: true,
      _count: { select: { variants: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const eligible = products.filter((product) => product._count.variants > 0);

  if (!restrictToIds) {
    return eligible.map((product) => product.id);
  }

  return eligible
    .sort(
      (left, right) =>
        (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    )
    .map((product) => product.id);
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

async function runPriceCheckJob(jobId: string) {
  const job = await prisma.priceCheckJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) {
    return;
  }

  if (job.productIds.length === 0) {
    await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.COMPLETED,
        completedAt: new Date(),
        reason: job.reason ?? "No eligible tracked products found.",
      },
    });
    return;
  }

  await prisma.priceCheckJob.update({
    where: { id: job.id },
    data: {
      status: PriceCheckJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  try {
    const result = await runPriceCheck({
      productIds: job.productIds,
      ignoreSchedule: true,
      onProgress: (progress) => updateJobProgress(job.id, progress),
    });

    await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.COMPLETED,
        checked: result.checked,
        changed: result.changed,
        pendingReview: result.pendingReview,
        failed: result.failed,
        skipped: result.skipped,
        reason: result.reason ?? null,
        completedAt: new Date(),
      },
    });

    logger.info("price-check/jobs", "Price check job completed", {
      jobId: job.id,
      result,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    await prisma.priceCheckJob.update({
      where: { id: job.id },
      data: {
        status: PriceCheckJobStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });

    logger.error("price-check/jobs", "Price check job failed", error, { jobId: job.id });
  }
}

export function ensurePriceCheckJobRunning(jobId: string) {
  const runningJobIds = getRunningJobIds();

  if (runningJobIds.has(jobId)) {
    return;
  }

  runningJobIds.add(jobId);

  void runPriceCheckJob(jobId).finally(() => {
    runningJobIds.delete(jobId);
  });
}

export async function createPriceCheckJob(input: CreateJobInput) {
  const activeJob = await findActivePriceCheckJob(input.userId);

  if (activeJob) {
    ensurePriceCheckJobRunning(activeJob.id);
    return { job: serializePriceCheckJob(activeJob), reused: true };
  }

  const requestedProductIds = normalizeProductIds(input.productIds);
  const isSelectedScope = requestedProductIds.length > 0;

  if (!isSelectedScope && !input.all) {
    throw new Error("Either productIds or all=true is required.");
  }

  const scope = isSelectedScope
    ? PriceCheckJobScope.SELECTED
    : PriceCheckJobScope.ALL;
  const eligibleProductIds = await resolveEligibleProductIds(requestedProductIds);
  const completedAt = eligibleProductIds.length === 0 ? new Date() : null;
  const reason =
    eligibleProductIds.length === 0
      ? isSelectedScope
        ? "No eligible tracked products found for the selected products."
        : "No eligible tracked products found."
      : null;
  const job = await prisma.priceCheckJob.create({
    data: {
      userId: input.userId,
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

  if (eligibleProductIds.length > 0) {
    ensurePriceCheckJobRunning(job.id);
  }

  return { job: serializePriceCheckJob(job), reused: false };
}

export async function getCurrentPriceCheckJob(userId: string) {
  const job = await findActivePriceCheckJob(userId);

  if (job) {
    ensurePriceCheckJobRunning(job.id);
  }

  return job ? serializePriceCheckJob(job) : null;
}

export async function getPriceCheckJobForUser(jobId: string, userId: string) {
  const job = await prisma.priceCheckJob.findFirst({
    where: {
      id: jobId,
      userId,
    },
  });

  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    ensurePriceCheckJobRunning(job.id);
  }

  return job ? serializePriceCheckJob(job) : null;
}
