import "server-only";

import { EbayImportJobStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  importEbayListings,
  type EbayImportResult,
  type ImportProgress,
} from "@/lib/ebay-import";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  assertNoEbayLaneStartConflict,
  getEbayReadLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";

const ACTIVE_IMPORT_JOB_STATUSES: EbayImportJobStatus[] = [
  EbayImportJobStatus.QUEUED,
  EbayImportJobStatus.RUNNING,
];

type EbayImportJobRecord = {
  id: string;
  userId: string;
  storeId: string;
  storeNumber: number;
  status: EbayImportJobStatus;
  quantity: number;
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  remainingAfterImport: number;
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  errors: Prisma.JsonValue;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
};

type CreateEbayImportJobInput = {
  userId: string;
  storeId: string;
  storeNumber: 1 | 2 | 3;
  quantity: number;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected eBay import job error";
}

function normalizeErrors(errors: Prisma.JsonValue) {
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const item = entry as Record<string, unknown>;
      const itemId = typeof item.itemId === "string" ? item.itemId : "";
      const title = typeof item.title === "string" ? item.title : "";
      const error = typeof item.error === "string" ? item.error : "";

      return itemId || title || error ? { itemId, title, error } : null;
    })
    .filter((entry): entry is { itemId: string; title: string; error: string } =>
      Boolean(entry),
    );
}

export function serializeEbayImportJob(job: EbayImportJobRecord) {
  return {
    id: job.id,
    storeId: job.storeId,
    status: job.status,
    quantity: job.quantity,
    requested: job.requested,
    activeListings: job.activeListings,
    alreadyImported: job.alreadyImported,
    remainingBeforeImport: job.remainingBeforeImport,
    remainingAfterImport: job.remainingAfterImport,
    processed: job.processed,
    total: job.total,
    created: job.created,
    skipped: job.skipped,
    failed: job.failed,
    rateLimited: job.rateLimited,
    errors: normalizeErrors(job.errors),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function findActiveEbayImportJob(storeId: string) {
  return prisma.ebayImportJob.findFirst({
    where: {
      storeId,
      status: { in: [...ACTIVE_IMPORT_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findNextRunnableEbayImportJob(storeId: string) {
  return prisma.ebayImportJob.findFirst({
    where: {
      storeId,
      status: { in: [...ACTIVE_IMPORT_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

async function updateJobProgress(jobId: string, progress: ImportProgress) {
  await prisma.ebayImportJob.update({
    where: { id: jobId },
    data: {
      processed: progress.processed,
      total: progress.total,
      created: progress.created,
      skipped: progress.skipped,
      failed: progress.failed,
    },
  });
}

function buildCompleteUpdate(result: EbayImportResult) {
  return {
    requested: result.requested,
    activeListings: result.activeListings,
    alreadyImported: result.alreadyImported,
    remainingBeforeImport: result.remainingBeforeImport,
    remainingAfterImport: result.remainingAfterImport,
    processed: result.requested,
    total: result.requested,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    rateLimited: result.rateLimited,
    errors: result.errors,
    completedAt: new Date(),
  };
}

async function runEbayImportJobClaimed(jobId: string) {
  const job = await prisma.ebayImportJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_IMPORT_JOB_STATUSES.includes(job.status)) {
    return;
  }

  await prisma.ebayImportJob.update({
    where: { id: job.id },
    data: {
      status: EbayImportJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });

  try {
    const result = await importEbayListings({
      storeId: job.storeId,
      storeNumber: job.storeNumber as 1 | 2 | 3,
      userId: job.userId,
      quantity: job.quantity,
      onProgress: (progress) => updateJobProgress(job.id, progress),
    });

    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: {
        status: EbayImportJobStatus.COMPLETED,
        ...buildCompleteUpdate(result),
      },
    });

    logger.info("ebay-import/jobs", "eBay import job completed", {
      jobId: job.id,
      result,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: {
        status: EbayImportJobStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });

    logger.error("ebay-import/jobs", "eBay import job failed", error, {
      jobId: job.id,
    });
  }
}

export async function runEbayImportJob(jobId: string, worker?: WorkerContext) {
  if (!worker) {
    await runEbayImportJobClaimed(jobId);
    return;
  }

  const job = await prisma.ebayImportJob.findUnique({ where: { id: jobId } });

  if (!job || !ACTIVE_IMPORT_JOB_STATUSES.includes(job.status)) {
    return;
  }

  await withJobLeases(
    getEbayReadLeaseInput(
      job.storeId,
      "EBAY_IMPORT",
      job.id,
      worker,
      "eBay import"
    ),
    () => runEbayImportJobClaimed(job.id)
  );
}

export async function createEbayImportJob(input: CreateEbayImportJobInput) {
  await assertNoEbayLaneStartConflict(input.storeId, "read");

  const activeJob = await findActiveEbayImportJob(input.storeId);

  if (activeJob) {
    return { job: serializeEbayImportJob(activeJob), reused: true };
  }

  const quantity = Math.max(1, Math.floor(input.quantity));
  const job = await prisma.ebayImportJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      storeNumber: input.storeNumber,
      quantity,
    },
  });

  return { job: serializeEbayImportJob(job), reused: false };
}

export async function getCurrentEbayImportJob(storeId: string) {
  const job = await findActiveEbayImportJob(storeId);

  return job ? serializeEbayImportJob(job) : null;
}

export async function getEbayImportJobForStore(jobId: string, storeId: string) {
  const job = await prisma.ebayImportJob.findFirst({
    where: {
      id: jobId,
      storeId,
      dismissedAt: null,
    },
  });

  return job ? serializeEbayImportJob(job) : null;
}

export async function runNextEbayImportJobForStore(
  storeId: string,
  worker?: WorkerContext
) {
  const job = await findNextRunnableEbayImportJob(storeId);

  if (!job) {
    return false;
  }

  try {
    await runEbayImportJob(job.id, worker);
    return true;
  } catch (error) {
    if (error instanceof JobConflictError) {
      return false;
    }

    throw error;
  }
}

export async function dismissEbayImportJob(jobId: string, storeId: string) {
  const terminalStatuses = [
    EbayImportJobStatus.COMPLETED,
    EbayImportJobStatus.FAILED,
  ];
  const job = await prisma.ebayImportJob.findFirst({
    where: {
      id: jobId,
      storeId,
      status: { in: terminalStatuses },
    },
  });

  if (!job) {
    return null;
  }

  const updated = await prisma.ebayImportJob.update({
    where: { id: job.id },
    data: { dismissedAt: job.dismissedAt ?? new Date() },
  });

  return serializeEbayImportJob(updated);
}
