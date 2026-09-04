import "server-only";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { WorkerContext } from "@/lib/job-coordination";
import { getWorkerClaimPolicy } from "@/lib/worker-claim-policy";
import { shouldDeferQueuedJob } from "@/lib/worker-routing";

export type WorkerScheduleClaim = {
  id: string;
  storeId: string;
  taskKey: string;
  workerId: string;
};

function scheduleLeaseExpiry(now: Date, leaseTtlMs: number) {
  return new Date(now.getTime() + leaseTtlMs);
}

export async function tryClaimWorkerSchedule(input: {
  storeId: string;
  taskKey: string;
  worker: WorkerContext;
  leaseTtlMs: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const schedule = await prisma.workerSchedule.upsert({
    where: {
      storeId_taskKey: {
        storeId: input.storeId,
        taskKey: input.taskKey,
      },
    },
    create: {
      storeId: input.storeId,
      taskKey: input.taskKey,
      nextRunAt: now,
    },
    update: {},
  });

  if (schedule.nextRunAt.getTime() > now.getTime()) {
    return null;
  }

  const policy = await getWorkerClaimPolicy(input.storeId, input.worker, now);
  if (
    shouldDeferQueuedJob({
      workerRole: input.worker.workerRole,
      specialistOnline: policy.specialistOnline,
      createdAt: schedule.nextRunAt,
      now,
      graceMs: policy.graceMs,
    })
  ) {
    return null;
  }

  const claimed = await prisma.workerSchedule.updateMany({
    where: {
      id: schedule.id,
      nextRunAt: { lte: now },
      OR: [
        { claimExpiresAt: null },
        { claimExpiresAt: { lte: now } },
      ],
    },
    data: {
      claimedBy: input.worker.workerId,
      claimedByName: input.worker.workerName,
      claimExpiresAt: scheduleLeaseExpiry(now, input.leaseTtlMs),
      lastStartedAt: now,
      lastError: null,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  const recoveredExpiredClaim =
    Boolean(schedule.claimedBy) &&
    Boolean(schedule.claimExpiresAt) &&
    schedule.claimExpiresAt!.getTime() <= now.getTime();

  logger.info("worker/schedule", "Worker claimed scheduled task", {
    storeId: input.storeId,
    taskKey: input.taskKey,
    workerId: input.worker.workerId,
    workerName: input.worker.workerName,
    workerRole: input.worker.workerRole,
    overdueMs: Math.max(0, now.getTime() - schedule.nextRunAt.getTime()),
    recoveredExpiredClaim,
    previousWorkerId: recoveredExpiredClaim ? schedule.claimedBy : null,
  });

  return {
    id: schedule.id,
    storeId: input.storeId,
    taskKey: input.taskKey,
    workerId: input.worker.workerId,
  } satisfies WorkerScheduleClaim;
}

async function renewWorkerSchedule(
  claim: WorkerScheduleClaim,
  leaseTtlMs: number,
) {
  const now = new Date();
  const renewed = await prisma.workerSchedule.updateMany({
    where: {
      id: claim.id,
      claimedBy: claim.workerId,
      claimExpiresAt: { gt: now },
    },
    data: {
      claimExpiresAt: scheduleLeaseExpiry(now, leaseTtlMs),
    },
  });

  if (renewed.count !== 1) {
    logger.warn("worker/schedule", "Scheduled task lease could not be renewed", {
      storeId: claim.storeId,
      taskKey: claim.taskKey,
      workerId: claim.workerId,
    });
    return false;
  }

  logger.debug("worker/schedule", "Worker renewed scheduled task lease", {
    storeId: claim.storeId,
    taskKey: claim.taskKey,
    workerId: claim.workerId,
  });
  return true;
}

export async function withWorkerScheduleClaim<T>(
  claim: WorkerScheduleClaim,
  leaseTtlMs: number,
  run: () => Promise<T>,
) {
  const renewEveryMs = Math.max(5_000, Math.floor(leaseTtlMs / 3));
  const renewal = setInterval(() => {
    void renewWorkerSchedule(claim, leaseTtlMs).catch((error) => {
      logger.warn("worker/schedule", "Scheduled task lease renewal failed", {
        storeId: claim.storeId,
        taskKey: claim.taskKey,
        workerId: claim.workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, renewEveryMs);
  renewal.unref?.();

  try {
    return await run();
  } finally {
    clearInterval(renewal);
  }
}

export async function completeWorkerSchedule(
  claim: WorkerScheduleClaim,
  intervalOrNextRunAt: number | Date,
  now = new Date(),
) {
  const nextRunAt =
    intervalOrNextRunAt instanceof Date
      ? intervalOrNextRunAt
      : new Date(now.getTime() + intervalOrNextRunAt);

  const completed = await prisma.workerSchedule.updateMany({
    where: { id: claim.id, claimedBy: claim.workerId },
    data: {
      nextRunAt,
      claimedBy: null,
      claimedByName: null,
      claimExpiresAt: null,
      lastCompletedAt: now,
      lastError: null,
    },
  });
  if (completed.count !== 1) {
    logger.warn("worker/schedule", "Scheduled task completion lost its claim", {
      storeId: claim.storeId,
      taskKey: claim.taskKey,
      workerId: claim.workerId,
    });
    return false;
  }
  logger.info("worker/schedule", "Worker completed scheduled task", {
    storeId: claim.storeId,
    taskKey: claim.taskKey,
    workerId: claim.workerId,
    nextRunAt: nextRunAt.toISOString(),
  });
  return true;
}

export async function retryWorkerSchedule(
  claim: WorkerScheduleClaim,
  retryAfterMs: number,
  error?: string,
  now = new Date(),
) {
  const deferred = await prisma.workerSchedule.updateMany({
    where: { id: claim.id, claimedBy: claim.workerId },
    data: {
      nextRunAt: new Date(now.getTime() + retryAfterMs),
      claimedBy: null,
      claimedByName: null,
      claimExpiresAt: null,
      lastError: error ?? null,
    },
  });
  if (deferred.count !== 1) {
    logger.warn("worker/schedule", "Scheduled task retry lost its claim", {
      storeId: claim.storeId,
      taskKey: claim.taskKey,
      workerId: claim.workerId,
      error: error ?? null,
    });
    return false;
  }
  logger.warn("worker/schedule", "Worker deferred scheduled task retry", {
    storeId: claim.storeId,
    taskKey: claim.taskKey,
    workerId: claim.workerId,
    retryAfterMs,
    error: error ?? null,
  });
  return true;
}
