import "server-only";

import {
  PriceCheckJobScope,
  PriceCheckJobStatus,
  PriceCheckJobTrigger,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  assertNoPriceCheckStartConflict,
  JobConflictError,
  type WorkerContext,
} from "@/lib/job-coordination";
import {
  createPriceCheckJob,
  runPriceCheckJob,
} from "@/lib/price-check-jobs";
import {
  AUTOMATIC_PRICE_CHECK_TASK_KEY,
  AUTOMATIC_PRICE_CHECK_TIMES,
  getNextScheduledCheckTime,
} from "@/lib/automatic-price-check-schedule";

export {
  AUTOMATIC_PRICE_CHECK_TASK_KEY,
  AUTOMATIC_PRICE_CHECK_TIMES,
  getNextScheduledCheckTime,
};

export interface StoreAutoCheckStatus {
  storeId: string;
  storeName: string;
  loginId: string | null;
  enabled: boolean;
  startedBy: string | null;
  startedAt: string | null;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  activeJobId: string | null;
  activeJobStatus: PriceCheckJobStatus | null;
}

export interface AutomaticPriceCheckSummary {
  enabled: boolean;
  scheduledTimes: string[];
  stores: StoreAutoCheckStatus[];
}

/**
 * Start automatic 8-hour price checks for all active stores (or a single store).
 * The first automatic run begins immediately upon pressing Start.
 */
export async function startAutomaticPriceCheck(options: {
  userId: string;
  storeId?: string;
}): Promise<AutomaticPriceCheckSummary> {
  const now = new Date();
  const stores = await prisma.store.findMany({
    where: {
      isActive: true,
      ...(options.storeId ? { id: options.storeId } : {}),
    },
    select: { id: true, name: true },
  });

  if (stores.length === 0) {
    throw new Error("No active stores found to start automatic price checks.");
  }

  for (const store of stores) {
    await prisma.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: store.id },
        data: {
          autoCheckEnabled: true,
          autoCheckStartedBy: options.userId,
          autoCheckStartedAt: now,
        },
      });

      // Upsert worker schedule row so workers immediately pick up the first run
      await tx.workerSchedule.upsert({
        where: {
          storeId_taskKey: {
            storeId: store.id,
            taskKey: AUTOMATIC_PRICE_CHECK_TASK_KEY,
          },
        },
        create: {
          storeId: store.id,
          taskKey: AUTOMATIC_PRICE_CHECK_TASK_KEY,
          nextRunAt: now,
        },
        update: {
          nextRunAt: now,
          lastError: null,
        },
      });
    });

    logger.info("automatic-price-check/start", "Automatic price check enabled for store", {
      storeId: store.id,
      storeName: store.name,
      userId: options.userId,
      nextRunAt: now.toISOString(),
    });
  }

  return getAutomaticPriceCheckStatus(options.storeId);
}

/**
 * Stop automatic price checks for all active stores (or a single store).
 */
export async function stopAutomaticPriceCheck(options: {
  storeId?: string;
}): Promise<AutomaticPriceCheckSummary> {
  const stores = await prisma.store.findMany({
    where: {
      isActive: true,
      ...(options.storeId ? { id: options.storeId } : {}),
    },
    select: { id: true, name: true },
  });

  for (const store of stores) {
    await prisma.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: store.id },
        data: {
          autoCheckEnabled: false,
          autoCheckStartedBy: null,
          autoCheckStartedAt: null,
        },
      });

      await tx.workerSchedule.deleteMany({
        where: {
          storeId: store.id,
          taskKey: AUTOMATIC_PRICE_CHECK_TASK_KEY,
        },
      });
    });

    logger.info("automatic-price-check/stop", "Automatic price check disabled for store", {
      storeId: store.id,
      storeName: store.name,
    });
  }

  return getAutomaticPriceCheckStatus(options.storeId);
}

/**
 * Get the current automatic price check status across all active stores.
 */
export async function getAutomaticPriceCheckStatus(
  storeId?: string
): Promise<AutomaticPriceCheckSummary> {
  const stores = await prisma.store.findMany({
    where: {
      isActive: true,
      ...(storeId ? { id: storeId } : {}),
    },
    select: {
      id: true,
      name: true,
      loginId: true,
      autoCheckEnabled: true,
      autoCheckStartedBy: true,
      autoCheckStartedAt: true,
    },
    orderBy: { name: "asc" },
  });

  if (stores.length === 0) {
    return {
      enabled: false,
      scheduledTimes: AUTOMATIC_PRICE_CHECK_TIMES.map((t) => t.label),
      stores: [],
    };
  }

  const storeIds = stores.map((s) => s.id);

  const [schedules, activeJobs] = await Promise.all([
    prisma.workerSchedule.findMany({
      where: {
        storeId: { in: storeIds },
        taskKey: AUTOMATIC_PRICE_CHECK_TASK_KEY,
      },
    }),
    prisma.priceCheckJob.findMany({
      where: {
        storeId: { in: storeIds },
        status: { in: [PriceCheckJobStatus.QUEUED, PriceCheckJobStatus.RUNNING] },
        dismissedAt: null,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const scheduleMap = new Map(schedules.map((s) => [s.storeId, s]));
  const activeJobMap = new Map(activeJobs.map((j) => [j.storeId ?? "", j]));

  const storeStatuses: StoreAutoCheckStatus[] = stores.map((store) => {
    const schedule = scheduleMap.get(store.id);
    const activeJob = activeJobMap.get(store.id);

    return {
      storeId: store.id,
      storeName: store.name,
      loginId: store.loginId,
      enabled: store.autoCheckEnabled,
      startedBy: store.autoCheckStartedBy,
      startedAt: store.autoCheckStartedAt?.toISOString() ?? null,
      nextRunAt: schedule?.nextRunAt?.toISOString() ?? null,
      lastStartedAt: schedule?.lastStartedAt?.toISOString() ?? null,
      lastCompletedAt: schedule?.lastCompletedAt?.toISOString() ?? null,
      lastError: schedule?.lastError ?? null,
      activeJobId: activeJob?.id ?? null,
      activeJobStatus: activeJob?.status ?? null,
    };
  });

  const anyEnabled = storeStatuses.some((s) => s.enabled);

  return {
    enabled: anyEnabled,
    scheduledTimes: AUTOMATIC_PRICE_CHECK_TIMES.map((t) => t.label),
    stores: storeStatuses,
  };
}

/**
 * Execute one automatic full price check run for a store.
 * Called by local workers when they claim the "automatic-price-check" schedule task.
 */
export async function runAutomaticPriceCheckForStore(
  storeId: string,
  worker: WorkerContext
): Promise<{
  skipped: boolean;
  skippedConflict: boolean;
  jobId?: string;
  reason?: string;
}> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      isActive: true,
      autoCheckEnabled: true,
      autoCheckStartedBy: true,
    },
  });

  if (!store || !store.isActive || !store.autoCheckEnabled) {
    return {
      skipped: true,
      skippedConflict: false,
      reason: "Automatic price checks are not active for this store.",
    };
  }

  // Check if a conflicting price check (e.g. manual full check or single check) is already active
  try {
    await assertNoPriceCheckStartConflict({
      storeId,
      scope: PriceCheckJobScope.ALL,
      productIds: [],
    });
  } catch (error) {
    if (error instanceof JobConflictError) {
      logger.info(
        "automatic-price-check/conflict",
        "Automatic check deferred because a manual job is active",
        { storeId, storeName: store.name, reason: error.message }
      );
      return {
        skipped: true,
        skippedConflict: true,
        reason: error.message,
      };
    }
    throw error;
  }

  // Resolve user ID for the job
  let userId = store.autoCheckStartedBy;
  if (!userId) {
    const firstUser = await prisma.user.findFirst({ select: { id: true } });
    userId = firstUser?.id ?? "system";
  }

  // Create an automatic full price check job
  const { job } = await createPriceCheckJob({
    userId,
    storeId,
    all: true,
    trigger: PriceCheckJobTrigger.AUTOMATIC,
  });

  logger.info("automatic-price-check/job-created", "Automatic price check job created", {
    storeId,
    storeName: store.name,
    jobId: job.id,
    total: job.total,
    workerId: worker.workerId,
  });

  // Run the price check job
  await runPriceCheckJob(job.id, worker);

  return {
    skipped: false,
    skippedConflict: false,
    jobId: job.id,
  };
}
