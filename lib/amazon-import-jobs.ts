import "server-only";

import {
  AmazonImportJobKind,
  AmazonImportJobStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { AmazonDirectScrapeError } from "@/lib/amazon-direct-scraper";
import {
  executeAmazonImport,
  type AmazonImportExecutionMode,
} from "@/lib/amazon-import";
import {
  getAmazonImportRetryPlan,
  isAmazonImportPeerRetry,
} from "@/lib/amazon-import-job-policy";
import type { AmazonPriceTrackingMode } from "@/lib/amazon-price-tracking";
import type { WorkerContext } from "@/lib/job-coordination";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  filterRunnableJobsForWorker,
  getWorkerClaimPolicy,
} from "@/lib/worker-claim-policy";

const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const AMAZON_RETRY_DELAY_MS = 1_000;
const STALE_RUNNING_JOB_MS = Math.max(
  180_000,
  Number(process.env.LISTFLOW_WORKER_LEASE_TTL_MS ?? 90_000) * 2,
);

export type CreateAmazonImportJobInput = {
  userId: string;
  storeId: string;
  url: string;
  asin: string;
  kind: AmazonImportJobKind;
  priceTrackingMode?: AmazonPriceTrackingMode;
};

function getExecutionMode(kind: AmazonImportJobKind): AmazonImportExecutionMode {
  if (kind === AmazonImportJobKind.ADVANCED) return "advanced";
  if (kind === AmazonImportJobKind.REGRAB) return "regrab";
  return "normal";
}

function getErrorDetails(error: unknown) {
  if (error instanceof AmazonDirectScrapeError) {
    return {
      message: error.message,
      code: error.code,
      status: error.status,
    };
  }

  return {
    message:
      error instanceof Error ? error.message : "Amazon import failed unexpectedly.",
    code: "AMAZON_IMPORT_FAILED",
    status: 422,
  };
}

export function serializeAmazonImportJob(job: {
  id: string;
  status: AmazonImportJobStatus;
  stage: string;
  progress: number;
  result: Prisma.JsonValue | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorStatus: number | null;
  workerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    result:
      job.status === AmazonImportJobStatus.COMPLETED ? job.result : null,
    errorMessage:
      job.status === AmazonImportJobStatus.FAILED ? job.errorMessage : null,
    errorCode: job.status === AmazonImportJobStatus.FAILED ? job.errorCode : null,
    errorStatus:
      job.status === AmazonImportJobStatus.FAILED ? job.errorStatus : null,
    workerName: job.workerName,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function createAmazonImportJob(input: CreateAmazonImportJobInput) {
  const existing = await prisma.amazonImportJob.findFirst({
    where: {
      userId: input.userId,
      storeId: input.storeId,
      asin: input.asin,
      kind: input.kind,
      status: {
        in: [
          AmazonImportJobStatus.QUEUED,
          AmazonImportJobStatus.RUNNING,
          AmazonImportJobStatus.READY,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing;

  return prisma.amazonImportJob.create({
    data: {
      userId: input.userId,
      storeId: input.storeId,
      sourceUrl: input.url,
      asin: input.asin,
      kind: input.kind,
      requestedPriceTrackingMode: input.priceTrackingMode,
      expiresAt: new Date(Date.now() + JOB_RETENTION_MS),
    },
  });
}

export async function getAmazonImportJobForUser(
  jobId: string,
  userId: string,
  storeId: string,
) {
  return prisma.amazonImportJob.findFirst({
    where: { id: jobId, userId, storeId },
  });
}

async function findRunnableJobs(storeId: string, worker: WorkerContext) {
  const now = new Date();
  await prisma.amazonImportJob.updateMany({
    where: {
      storeId,
      status: AmazonImportJobStatus.RUNNING,
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: AmazonImportJobStatus.QUEUED,
      stage: "RECOVERED_AFTER_WORKER_TIMEOUT",
      progress: 5,
      requiredWorkerRole: null,
      nextAttemptAt: now,
      leaseExpiresAt: null,
    },
  });

  const jobs = await prisma.amazonImportJob.findMany({
    where: {
      storeId,
      status: AmazonImportJobStatus.QUEUED,
      nextAttemptAt: { lte: now },
      AND: [
        {
          OR: [
            { requiredWorkerRole: null },
            { requiredWorkerRole: worker.workerRole },
          ],
        },
        {
          OR: [
            { stage: { not: "RETRYING_ON_PEER_WORKER" } },
            { workerId: { not: worker.workerId } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  const forcedForWorker = jobs.filter(
    (job) =>
      job.requiredWorkerRole === worker.workerRole &&
      (!isAmazonImportPeerRetry(job) || job.workerId !== worker.workerId),
  );
  const unassigned = jobs.filter((job) => job.requiredWorkerRole === null);
  const policy = await getWorkerClaimPolicy(storeId, worker, now);

  return [
    ...forcedForWorker,
    ...filterRunnableJobsForWorker(unassigned, worker, policy),
  ];
}

export async function runNextAmazonImportJobForStore(
  storeId: string,
  worker: WorkerContext,
) {
  const candidates = await findRunnableJobs(storeId, worker);

  for (const candidate of candidates) {
    const peerRetry = isAmazonImportPeerRetry(candidate);
    const claimed = await prisma.amazonImportJob.updateMany({
      where: {
        id: candidate.id,
        status: AmazonImportJobStatus.QUEUED,
        nextAttemptAt: { lte: new Date() },
        ...(peerRetry
          ? {
              stage: "RETRYING_ON_PEER_WORKER",
              NOT: { workerId: worker.workerId },
            }
          : {}),
      },
      data: {
        status: AmazonImportJobStatus.RUNNING,
        stage: "SCRAPE_STARTED",
        progress: 10,
        attempts: { increment: 1 },
        workerId: worker.workerId,
        workerName: worker.workerName,
        leaseExpiresAt: new Date(Date.now() + STALE_RUNNING_JOB_MS),
        startedAt: candidate.startedAt ?? new Date(),
        errorMessage: null,
        errorCode: null,
        errorStatus: null,
      },
    });

    if (claimed.count === 0) continue;

    const job = await prisma.amazonImportJob.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const jobLogger = logger.child({
      source: "worker",
      runtime: "worker",
      storeId,
      userId: job.userId,
      workerId: worker.workerId,
      workerName: worker.workerName,
      jobType: "AMAZON_IMPORT",
      jobId: job.id,
      asin: job.asin,
      tags: ["worker", "amazon-import"],
    });

    let latestProgress = job.progress;
    const updateProgress = (stage: string, progress: number) => {
      if (progress <= latestProgress) return;
      latestProgress = progress;
      void prisma.amazonImportJob
        .updateMany({
          where: {
            id: job.id,
            status: AmazonImportJobStatus.RUNNING,
            workerId: worker.workerId,
          },
          data: { stage: stage.toUpperCase(), progress },
        })
        .catch((error) =>
          jobLogger.warn("amazon-import/job", "Failed to persist job progress", {
            stage,
            progress,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    };

    try {
      jobLogger.info("amazon-import/job", "Amazon import job started", {
        mode: job.kind,
        attempt: job.attempts,
        workerRole: worker.workerRole,
      });

      const result = await executeAmazonImport({
        storeId,
        url: job.sourceUrl,
        mode: getExecutionMode(job.kind),
        priceTrackingMode:
          (job.requestedPriceTrackingMode as AmazonPriceTrackingMode | null) ??
          undefined,
        log: jobLogger,
        onProgress: updateProgress,
      });

      await prisma.amazonImportJob.update({
        where: { id: job.id },
        data: {
          status: AmazonImportJobStatus.COMPLETED,
          stage: "COMPLETED",
          progress: 100,
          result: result as Prisma.InputJsonValue,
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      jobLogger.info("amazon-import/job", "Amazon import job completed", {
        asin: result.asin,
        price: result.price,
        workerRole: worker.workerRole,
      });
    } catch (error) {
      const details = getErrorDetails(error);
      const retryPlan = getAmazonImportRetryPlan({
        workerRole: worker.workerRole,
        attempts: job.attempts,
        target: process.env.LISTFLOW_AMAZON_RETRY_TARGET,
      });

      if (retryPlan) {
        await prisma.amazonImportJob.update({
          where: { id: job.id },
          data: {
            status: AmazonImportJobStatus.QUEUED,
            stage: retryPlan.stage,
            progress: Math.max(latestProgress, 15),
            requiredWorkerRole: retryPlan.requiredWorkerRole,
            nextAttemptAt: new Date(Date.now() + AMAZON_RETRY_DELAY_MS),
            errorMessage: details.message,
            errorCode: details.code,
            errorStatus: details.status,
            leaseExpiresAt: null,
          },
        });
        jobLogger.warn(
          "amazon-import/job",
          retryPlan.target === "peer"
            ? "Store-specific import failed; queued peer worker retry"
            : "Store-specific import failed; queued unified worker retry",
          { ...details, retryTarget: retryPlan.target },
        );
      } else {
        await prisma.amazonImportJob.update({
          where: { id: job.id },
          data: {
            status: AmazonImportJobStatus.FAILED,
            stage: "FAILED",
            progress: 0,
            errorMessage: details.message,
            errorCode: details.code,
            errorStatus: details.status,
            completedAt: new Date(),
            leaseExpiresAt: null,
          },
        });
        jobLogger.error(
          "amazon-import/job",
          "Amazon import job failed",
          error,
          { ...details, workerRole: worker.workerRole },
        );
      }
    }

    return true;
  }

  return false;
}
