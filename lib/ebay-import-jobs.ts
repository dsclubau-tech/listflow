import "server-only";

import { EbayImportJobStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  importEbayListings,
  resolveEbayImportSelection,
  type EbayImportResult,
  type ImportProgress,
  type ImportSelection,
  type ImportStopReason,
} from "@/lib/ebay-import";
import {
  EbayImportSelectionError,
  type EbayImportSelectionMetadata,
  type EbayImportSortDirection,
  type EbayImportSortField,
} from "@/lib/ebay-import-selection";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { invalidateJobCaches } from "@/lib/cache-tags";
import {
  assertNoEbayLaneStartConflict,
  getEbayReadLeaseInput,
  JobConflictError,
  withJobLeases,
  type WorkerContext,
} from "@/lib/job-coordination";

const BLOCKING_IMPORT_JOB_STATUSES: EbayImportJobStatus[] = [
  EbayImportJobStatus.QUEUED,
  EbayImportJobStatus.RUNNING,
  EbayImportJobStatus.PAUSING,
  EbayImportJobStatus.PAUSED,
  EbayImportJobStatus.CANCELLING,
];
const RUNNABLE_IMPORT_JOB_STATUSES: EbayImportJobStatus[] = [
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
  selectedListingIds: string[];
  completedListingIds: string[];
  metadata: Prisma.JsonValue;
  rateLimited: boolean;
  errors: Prisma.JsonValue;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  dismissedAt: Date | null;
};

type CreateEbayImportJobInput = {
  userId: string;
  storeId: string;
  storeNumber: 1 | 2 | 3;
  quantity: number;
  skuList?: string[];
  sortField?: EbayImportSortField;
  sortDirection?: EbayImportSortDirection;
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

function normalizeMetadata(metadata: Prisma.JsonValue): Partial<EbayImportSelectionMetadata> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const source = metadata as Record<string, unknown>;
  const mode = source.mode === "SKU" || source.mode === "QUANTITY" ? source.mode : undefined;
  const skuList = Array.isArray(source.skuList)
    ? source.skuList.filter((sku): sku is string => typeof sku === "string")
    : undefined;
  const unmatchedSkus = Array.isArray(source.unmatchedSkus)
    ? source.unmatchedSkus.filter((sku): sku is string => typeof sku === "string")
    : undefined;
  const sortDirection =
    source.sortDirection === "ASC" || source.sortDirection === "DESC"
      ? source.sortDirection
      : undefined;
  const matchedSkuCount =
    typeof source.matchedSkuCount === "number" ? source.matchedSkuCount : undefined;
  const selectedListingCount =
    typeof source.selectedListingCount === "number"
      ? source.selectedListingCount
      : undefined;

  return {
    ...(mode ? { mode } : {}),
    ...(skuList ? { skuList } : {}),
    ...(unmatchedSkus ? { unmatchedSkus } : {}),
    ...(matchedSkuCount !== undefined ? { matchedSkuCount } : {}),
    ...(selectedListingCount !== undefined ? { selectedListingCount } : {}),
    sortField: "START_DATE",
    ...(sortDirection ? { sortDirection } : {}),
  };
}

function getProgressPercent(job: Pick<EbayImportJobRecord, "processed" | "total" | "requested" | "quantity">) {
  const total = job.total || job.requested || job.quantity;

  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((job.processed / total) * 100));
}

function canPauseImportJob(status: EbayImportJobStatus) {
  return status === EbayImportJobStatus.QUEUED || status === EbayImportJobStatus.RUNNING;
}

function canResumeImportJob(status: EbayImportJobStatus) {
  return status === EbayImportJobStatus.PAUSED;
}

function canCancelImportJob(status: EbayImportJobStatus) {
  return (
    status === EbayImportJobStatus.QUEUED ||
    status === EbayImportJobStatus.RUNNING ||
    status === EbayImportJobStatus.PAUSING ||
    status === EbayImportJobStatus.PAUSED
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
    selectedListingIds: job.selectedListingIds,
    completedListingIds: job.completedListingIds,
    metadata: normalizeMetadata(job.metadata),
    progressPercent: getProgressPercent(job),
    canPause: canPauseImportJob(job.status),
    canResume: canResumeImportJob(job.status),
    canCancel: canCancelImportJob(job.status),
    rateLimited: job.rateLimited,
    errors: normalizeErrors(job.errors),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    pausedAt: job.pausedAt?.toISOString() ?? null,
    cancelledAt: job.cancelledAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function findActiveEbayImportJob(storeId: string) {
  return prisma.ebayImportJob.findFirst({
    where: {
      storeId,
      status: { in: [...BLOCKING_IMPORT_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findNextRunnableEbayImportJob(storeId: string) {
  return prisma.ebayImportJob.findFirst({
    where: {
      storeId,
      status: { in: [...RUNNABLE_IMPORT_JOB_STATUSES] },
      dismissedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

async function updateJobSelection(jobId: string, selection: ImportSelection) {
  await prisma.ebayImportJob.update({
    where: { id: jobId },
    data: {
      requested: selection.requested,
      activeListings: selection.activeListings,
      alreadyImported: selection.alreadyImported,
      remainingBeforeImport: selection.remainingBeforeImport,
      total: selection.selectedListingIds.length,
      selectedListingIds: selection.selectedListingIds,
      metadata: selection.metadata as unknown as Prisma.InputJsonValue,
    },
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
      ...(progress.completedListingIds
        ? { completedListingIds: progress.completedListingIds }
        : {}),
    },
  });
}

function buildResultUpdate(result: EbayImportResult) {
  return {
    requested: result.requested,
    activeListings: result.activeListings,
    alreadyImported: result.alreadyImported,
    remainingBeforeImport: result.remainingBeforeImport,
    remainingAfterImport: result.remainingAfterImport,
    processed: result.processed,
    total: result.requested,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    selectedListingIds: result.selectedListingIds,
    completedListingIds: result.completedListingIds,
    metadata: result.metadata as unknown as Prisma.InputJsonValue,
    rateLimited: result.rateLimited,
    errors: result.errors,
  };
}

async function getImportStopReason(jobId: string): Promise<ImportStopReason | null> {
  const job = await prisma.ebayImportJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  if (!job) {
    return "CANCELLED";
  }

  if (
    job.status === EbayImportJobStatus.PAUSING ||
    job.status === EbayImportJobStatus.PAUSED
  ) {
    return "PAUSED";
  }

  if (
    job.status === EbayImportJobStatus.CANCELLING ||
    job.status === EbayImportJobStatus.CANCELLED
  ) {
    return "CANCELLED";
  }

  return null;
}

async function runEbayImportJobClaimed(jobId: string) {
  const job = await prisma.ebayImportJob.findUnique({ where: { id: jobId } });

  if (!job || !RUNNABLE_IMPORT_JOB_STATUSES.includes(job.status)) {
    return;
  }

  await prisma.ebayImportJob.update({
    where: { id: job.id },
    data: {
      status: EbayImportJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      pausedAt: null,
      errorMessage: null,
    },
  });

  try {
    const storedMetadata = normalizeMetadata(job.metadata);
    const result = await importEbayListings({
      storeId: job.storeId,
      storeNumber: job.storeNumber as 1 | 2 | 3,
      userId: job.userId,
      quantity: job.quantity,
      selectionMetadata: storedMetadata.mode
        ? (storedMetadata as EbayImportSelectionMetadata)
        : undefined,
      selectedListingIds: job.selectedListingIds,
      completedListingIds: job.completedListingIds,
      initialCreated: job.created,
      initialSkipped: job.skipped,
      initialFailed: job.failed,
      initialErrors: normalizeErrors(job.errors),
      previousRemainingBeforeImport: job.remainingBeforeImport,
      onSelectionResolved: (selection) => updateJobSelection(job.id, selection),
      onProgress: (progress) => updateJobProgress(job.id, progress),
      shouldStop: () => getImportStopReason(job.id),
    });

    const now = new Date();
    const resultUpdate = buildResultUpdate(result);
    const nextStatus =
      result.stopReason === "PAUSED"
        ? EbayImportJobStatus.PAUSED
        : result.stopReason === "CANCELLED"
          ? EbayImportJobStatus.CANCELLED
          : EbayImportJobStatus.COMPLETED;

    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        ...resultUpdate,
        pausedAt: result.stopReason === "PAUSED" ? now : null,
        cancelledAt: result.stopReason === "CANCELLED" ? now : null,
        completedAt: result.stopReason === "PAUSED" ? null : now,
      },
    });

    logger.info("ebay-import/jobs", "eBay import job finished", {
      jobId: job.id,
      status: nextStatus,
      result,
    });
    invalidateJobCaches(job.storeId);
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
    invalidateJobCaches(job.storeId);
  }
}

export async function runEbayImportJob(jobId: string, worker?: WorkerContext) {
  if (!worker) {
    await runEbayImportJobClaimed(jobId);
    return;
  }

  const job = await prisma.ebayImportJob.findUnique({ where: { id: jobId } });

  if (!job || !RUNNABLE_IMPORT_JOB_STATUSES.includes(job.status)) {
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
  const selection = await resolveEbayImportSelection({
    storeId: input.storeId,
    storeNumber: input.storeNumber,
    quantity,
    skuList: input.skuList,
    sortField: input.sortField,
    sortDirection: input.sortDirection,
    forceRefresh: true,
  });

  if (selection.metadata.mode === "SKU" && selection.selectedListingIds.length === 0) {
    throw new EbayImportSelectionError(
      "No active, not-yet-imported eBay listings matched the supplied SKU/custom label values.",
    );
  }

  const jobQuantity =
    selection.metadata.mode === "SKU"
      ? Math.max(1, selection.selectedListingIds.length)
      : quantity;
  const job = await prisma.ebayImportJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      storeNumber: input.storeNumber,
      quantity: jobQuantity,
      requested: selection.requested,
      activeListings: selection.activeListings,
      alreadyImported: selection.alreadyImported,
      remainingBeforeImport: selection.remainingBeforeImport,
      remainingAfterImport: selection.remainingBeforeImport,
      total: selection.selectedListingIds.length,
      selectedListingIds: selection.selectedListingIds,
      metadata: selection.metadata as unknown as Prisma.InputJsonValue,
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
    EbayImportJobStatus.CANCELLED,
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

export async function pauseEbayImportJob(jobId: string, storeId: string) {
  const job = await prisma.ebayImportJob.findFirst({
    where: { id: jobId, storeId, dismissedAt: null },
  });

  if (!job) {
    return null;
  }

  if (job.status === EbayImportJobStatus.PAUSED || job.status === EbayImportJobStatus.PAUSING) {
    return serializeEbayImportJob(job);
  }

  if (!canPauseImportJob(job.status)) {
    return null;
  }

  const updated = await prisma.ebayImportJob.update({
    where: { id: job.id },
    data:
      job.status === EbayImportJobStatus.QUEUED
        ? { status: EbayImportJobStatus.PAUSED, pausedAt: new Date() }
        : { status: EbayImportJobStatus.PAUSING },
  });

  return serializeEbayImportJob(updated);
}

export async function resumeEbayImportJob(jobId: string, storeId: string) {
  const job = await prisma.ebayImportJob.findFirst({
    where: { id: jobId, storeId, dismissedAt: null },
  });

  if (!job) {
    return null;
  }

  if (job.status === EbayImportJobStatus.QUEUED || job.status === EbayImportJobStatus.RUNNING) {
    return serializeEbayImportJob(job);
  }

  if (!canResumeImportJob(job.status)) {
    return null;
  }

  const updated = await prisma.ebayImportJob.update({
    where: { id: job.id },
    data: {
      status: EbayImportJobStatus.QUEUED,
      pausedAt: null,
      completedAt: null,
      errorMessage: null,
    },
  });

  return serializeEbayImportJob(updated);
}

export async function cancelEbayImportJob(jobId: string, storeId: string) {
  const job = await prisma.ebayImportJob.findFirst({
    where: { id: jobId, storeId, dismissedAt: null },
  });

  if (!job) {
    return null;
  }

  if (job.status === EbayImportJobStatus.CANCELLED || job.status === EbayImportJobStatus.CANCELLING) {
    return serializeEbayImportJob(job);
  }

  if (!canCancelImportJob(job.status)) {
    return null;
  }

  const now = new Date();
  const updated = await prisma.ebayImportJob.update({
    where: { id: job.id },
    data:
      job.status === EbayImportJobStatus.QUEUED ||
      job.status === EbayImportJobStatus.PAUSED
        ? {
            status: EbayImportJobStatus.CANCELLED,
            cancelledAt: now,
            completedAt: now,
          }
        : { status: EbayImportJobStatus.CANCELLING },
  });

  return serializeEbayImportJob(updated);
}
