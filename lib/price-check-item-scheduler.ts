import "server-only";

import { randomUUID } from "node:crypto";
import {
  PriceCheckJobStatus,
  PriceCheckJobTrigger,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { runPriceCheck, type PriceCheckResult } from "@/lib/price-checker";
import { queuePriceCheckAutoHoldForRun } from "@/lib/price-check-auto-hold";
import { JOB_LEASE_RENEW_MS, JOB_LEASE_TTL_MS, JobConflictError,
  getEbayWriteLeaseInput, withJobLeases, type WorkerContext } from "@/lib/job-coordination";
import { orderPriceCheckJobs, canClaimProduct } from "@/lib/price-check-scheduling-policy";

const CHECK_PREFIX = "price-check-products:product:";
const FULL_CHECK_KEY = "price-check-products:all";
const MAX_ACTIVE_CHECKS = 2;
const MANUAL_BURST = 10;

export async function itemSchedulerEnabled(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { priceCheckItemSchedulerEnabled: true },
  });
  return store?.priceCheckItemSchedulerEnabled === true;
}

export async function getPriceCheckItemDiagnostics(storeId: string, jobId: string) {
  const now = new Date();
  const [counts, running, pendingItems, lastCompleted, recentWorkers, cooldown, failedItems,
    storeRunning] = await Promise.all([
    prisma.priceCheckJobItem.groupBy({ by: ["status"], where: { jobId },
      _count: { _all: true } }),
    prisma.priceCheckJobItem.findMany({ where: { jobId, status: "RUNNING",
        leaseExpiresAt: { gt: now } },
      select: { workerId: true, workerName: true, productId: true }, take: 2 }),
    prisma.priceCheckJobItem.findMany({ where: { jobId, status: "PENDING" },
      orderBy: { position: "asc" }, take: 5, select: { productId: true } }),
    prisma.priceCheckJobItem.findFirst({ where: { jobId, completedAt: { not: null } },
      orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    prisma.workerHeartbeat.findMany({ where: { storeId, workerRole: "store-specific",
      lastSeenAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } },
      orderBy: { workerName: "asc" }, take: 10,
      select: { workerId: true, workerName: true, lastSeenAt: true } }),
    prisma.priceCheckScheduleState.findUnique({ where: { storeId },
      select: { amazonBlockedUntil: true } }),
    prisma.priceCheckJobItem.findMany({
      where: { jobId, failed: { gt: 0 } },
      orderBy: { completedAt: "desc" }, take: 5,
      select: { productId: true, errorMessage: true },
    }),
    prisma.priceCheckJobItem.count({ where: { storeId, status: "RUNNING",
      leaseExpiresAt: { gt: now } } }),
  ]);
  const onlineWorkers = recentWorkers.filter((worker) =>
    worker.lastSeenAt > new Date(now.getTime() - 60_000));
  const currentLeases = onlineWorkers.length > 0
    ? await prisma.jobLease.findMany({ where: { storeId,
        workerId: { in: onlineWorkers.map((worker) => worker.workerId) },
        expiresAt: { gt: now }, NOT: { jobType: "GATE" } },
        select: { workerId: true, jobType: true, details: true } })
    : [];
  const workerActivities = recentWorkers.map((worker) => {
    if (worker.lastSeenAt <= new Date(now.getTime() - 60_000)) {
      return { name: worker.workerName, activity: "Offline" };
    }
    const workingItem = running.some((item) => item.workerId === worker.workerId);
    const lease = currentLeases.find((entry) => entry.workerId === worker.workerId);
    const label = lease?.details && typeof lease.details === "object" &&
      !Array.isArray(lease.details) && "label" in lease.details &&
      typeof lease.details.label === "string" ? lease.details.label : null;
    return { name: worker.workerName,
      activity: workingItem ? "Checking a product" : label ??
        (lease ? lease.jobType.replaceAll("_", " ").toLowerCase() : "Available") };
  });
  const count = (status: string) => counts.find((entry) => entry.status === status)?._count._all ?? 0;
  const pending = count("PENDING");
  const retryWaiting = count("RETRY_WAIT");
  let waitReason: string | null = null;
  if (cooldown?.amazonBlockedUntil && cooldown.amazonBlockedUntil > now) {
    waitReason = "Amazon retry delayed";
  } else if (running.length === 0 && onlineWorkers.length === 0) {
    waitReason = "Worker offline";
  } else if (pending === 0 && retryWaiting > 0) {
    waitReason = "Amazon retry delayed";
  } else if (pendingItems.length > 0) {
    const leases = await prisma.jobLease.findMany({ where: { storeId,
      resourceKey: { in: pendingItems.map((item) => `${CHECK_PREFIX}${item.productId}`) },
      expiresAt: { gt: now } }, select: { resourceKey: true } });
    waitReason = leases.length === pendingItems.length
      ? "Waiting for this product’s current check"
      : storeRunning >= MAX_ACTIVE_CHECKS
        ? "Queued — both workers busy" : "Waiting for an available worker";
  }
  return {
    pendingItems: pending,
    runningItems: running.length,
    retryWaitingItems: retryWaiting,
    assignedWorkerNames: running.map((item) => item.workerName ?? "Worker"),
    workerActivities,
    lastProgressAt: lastCompleted?.completedAt?.toISOString() ?? null,
    waitReason,
    failedItems,
  };
}

type ClaimedItem = {
  id: string;
  jobId: string;
  productId: string;
  storeId: string;
  token: string;
  startedAt: Date;
  userId: string;
};

async function claimNextItem(
  storeId: string,
  worker: WorkerContext,
  manualOnly: boolean,
): Promise<ClaimedItem | null> {
  return prisma.$transaction(async (tx) => {
    // Serialize claims for this store. Other stores may still claim in parallel.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${storeId}`}))`;
    const now = new Date();
    // A worker may have sent an eBay request before dying. Mark that item for
    // review instead of replaying an update whose remote outcome is unknown.
    const uncertain = await tx.priceCheckJobItem.findMany({
      where: { storeId, status: "RUNNING", leaseExpiresAt: { lte: now },
        OR: [{ remoteWriteStarted: true }, { attempts: { gte: 3 } }] },
      take: 25,
    });
    for (const expired of uncertain) {
      await tx.priceCheckJobItem.update({
        where: { id: expired.id },
        data: { status: "FAILED", errorMessage: expired.remoteWriteStarted
          ? "eBay outcome uncertain after worker interruption; reconcile before retry."
          : "Price check interrupted three times; review before retry.",
          failed: 1, checked: 1, completedAt: now },
      });
      await tx.priceCheckJob.update({
        where: { id: expired.jobId },
        data: { completedProductIds: { push: expired.productId },
          checked: { increment: 1 }, failed: { increment: 1 } },
      });
      await tx.jobLease.deleteMany({
        where: { storeId, jobType: "PRICE_CHECK_ITEM", jobId: expired.id,
          expiresAt: { lte: now } },
      });
      const remaining = await tx.priceCheckJobItem.count({
        where: { jobId: expired.jobId,
          status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] } },
      });
      if (remaining === 0) {
        await tx.priceCheckJob.updateMany({
          where: { id: expired.jobId,
            status: { in: [PriceCheckJobStatus.RUNNING, PriceCheckJobStatus.QUEUED] } },
          data: { status: PriceCheckJobStatus.COMPLETED, completedAt: now },
        });
      }
    }
    const fullCheck = await tx.jobLease.findUnique({
      where: { storeId_resourceKey: { storeId, resourceKey: FULL_CHECK_KEY } },
    });
    if (fullCheck && fullCheck.expiresAt > now) return null;
    const activeCount = await tx.priceCheckJobItem.count({
      where: { storeId, status: "RUNNING", leaseExpiresAt: { gt: now } },
    });
    if (activeCount >= MAX_ACTIVE_CHECKS) return null;

    const cooldown = await tx.priceCheckScheduleState.upsert({
      where: { storeId }, create: { storeId }, update: {},
    });
    if (cooldown.amazonBlockedUntil && cooldown.amazonBlockedUntil > now) return null;
    // After a cooldown, let a single check probe Amazon before both workers resume.
    if (cooldown.consecutivePostcodeFailures >= 3 && activeCount > 0) return null;
    const activeProductLeases = await tx.jobLease.findMany({
      where: { storeId, resourceKey: { startsWith: CHECK_PREFIX },
        expiresAt: { gt: now } },
      select: { resourceKey: true },
    });
    const lockedProductIds = new Set(activeProductLeases.map((lease) =>
      lease.resourceKey.slice(CHECK_PREFIX.length)));

    const jobWhere = {
      storeId, schedulerVersion: 2, dismissedAt: null,
      status: { in: [PriceCheckJobStatus.QUEUED, PriceCheckJobStatus.RUNNING] },
    };
    const [manual, automatic] = await Promise.all([
      tx.priceCheckJob.findMany({
        where: { ...jobWhere, trigger: PriceCheckJobTrigger.MANUAL },
        orderBy: { createdAt: "asc" }, take: 50,
        select: { id: true, userId: true, trigger: true },
      }),
      tx.priceCheckJob.findMany({
        where: { ...jobWhere, trigger: PriceCheckJobTrigger.AUTOMATIC },
        orderBy: { createdAt: "asc" }, take: 50,
        select: { id: true, userId: true, trigger: true },
      }),
    ]);
    if (manual.length + automatic.length === 0) return null;

    const schedule = cooldown;
    const ordered = manualOnly
      ? manual
      : orderPriceCheckJobs(manual, automatic, schedule.manualStreak, MANUAL_BURST);

    for (const job of ordered) {
      const items = await tx.priceCheckJobItem.findMany({
        where: {
          jobId: job.id,
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now } },
            { status: "RETRY_WAIT", nextAttemptAt: { lte: now } },
            { status: "RUNNING", leaseExpiresAt: { lte: now } },
          ],
          ...(lockedProductIds.size > 0
            ? { productId: { notIn: [...lockedProductIds] } }
            : {}),
        },
        orderBy: { position: "asc" },
        take: 50,
      });
      for (const item of items) {
        if (!canClaimProduct(item.productId, lockedProductIds)) continue;
        const resourceKey = `${CHECK_PREFIX}${item.productId}`;
        const existing = await tx.jobLease.findUnique({
          where: { storeId_resourceKey: { storeId, resourceKey } },
        });
        if (existing && existing.expiresAt > now) continue;
        if (existing) await tx.jobLease.delete({ where: { id: existing.id } });

        const token = randomUUID();
        const expiresAt = new Date(now.getTime() + JOB_LEASE_TTL_MS);
        await tx.jobLease.create({
          data: {
            storeId, resourceKey, jobType: "PRICE_CHECK_ITEM", jobId: item.id,
            workerId: worker.workerId, workerName: worker.workerName, expiresAt,
            details: { token, productId: item.productId, parentJobId: job.id },
          },
        });
        await tx.priceCheckJobItem.update({
          where: { id: item.id },
          data: {
            status: "RUNNING", workerId: worker.workerId,
            workerName: worker.workerName, claimToken: token,
            leaseExpiresAt: expiresAt, startedAt: now,
            attempts: { increment: 1 }, errorMessage: null,
            remoteWriteStarted: false,
          },
        });
        await tx.priceCheckJob.updateMany({
          where: { id: job.id, status: PriceCheckJobStatus.QUEUED },
          data: { status: PriceCheckJobStatus.RUNNING, startedAt: now },
        });
        await tx.priceCheckScheduleState.update({
          where: { storeId },
          data: { manualStreak: job.trigger === PriceCheckJobTrigger.MANUAL
            ? { increment: 1 } : 0 },
        });
        return {
          id: item.id, jobId: job.id, productId: item.productId,
          storeId, token, startedAt: now, userId: job.userId,
        };
      }
    }
    return null;
  }, { timeout: 15_000 });
}

async function assertOwnership(item: ClaimedItem) {
  const now = new Date();
  const current = await prisma.priceCheckJobItem.findFirst({
    where: {
      id: item.id, claimToken: item.token, status: "RUNNING",
      leaseExpiresAt: { gt: now },
      job: { status: { in: [PriceCheckJobStatus.RUNNING, PriceCheckJobStatus.CANCELLING] } },
    },
    select: { id: true },
  });
  if (!current) throw new Error("Price-check item lease or job ownership was lost.");
  const lease = await prisma.jobLease.findUnique({
    where: {
      storeId_resourceKey: {
        storeId: item.storeId,
        resourceKey: `${CHECK_PREFIX}${item.productId}`,
      },
    },
  });
  if (lease?.jobId !== item.id || lease.expiresAt <= now ||
      (lease.details as { token?: string } | null)?.token !== item.token) {
    throw new Error("Price-check product lease was lost.");
  }
}

async function renew(item: ClaimedItem) {
  const expiresAt = new Date(Date.now() + JOB_LEASE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.priceCheckJobItem.updateMany({
      where: {
        id: item.id, claimToken: item.token, status: "RUNNING",
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt: expiresAt },
    });
    if (updated.count !== 1) throw new Error("Price-check item lease renewal lost ownership.");
    const renewed = await tx.jobLease.updateMany({
      where: { storeId: item.storeId, jobType: "PRICE_CHECK_ITEM", jobId: item.id,
        resourceKey: `${CHECK_PREFIX}${item.productId}` },
      data: { renewedAt: new Date(), expiresAt },
    });
    if (renewed.count !== 1) throw new Error("Price-check product lease renewal lost ownership.");
  });
}

async function complete(item: ClaimedItem, result: PriceCheckResult, errorMessage?: string) {
  const completed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${item.storeId}`}))`;
    const current = await tx.priceCheckJobItem.findFirst({
      where: { id: item.id, claimToken: item.token, status: "RUNNING",
        leaseExpiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!current) return false;
    const lease = await tx.jobLease.findUnique({
      where: { storeId_resourceKey: { storeId: item.storeId,
        resourceKey: `${CHECK_PREFIX}${item.productId}` } },
    });
    if (lease?.jobId !== item.id || lease.expiresAt <= new Date() ||
        (lease.details as { token?: string } | null)?.token !== item.token) return false;
    const parent = await tx.priceCheckJob.findUnique({
      where: { id: item.jobId }, select: { status: true },
    });
    if (parent?.status !== PriceCheckJobStatus.RUNNING &&
        parent?.status !== PriceCheckJobStatus.CANCELLING) return false;

    const claimed = await tx.priceCheckJobItem.updateMany({
      where: { id: item.id, claimToken: item.token, status: "RUNNING",
        leaseExpiresAt: { gt: new Date() } },
      data: {
        status: result.failed > 0 ? "FAILED" : "COMPLETED",
        checked: result.checked, changed: result.changed,
        pendingReview: result.pendingReview, failed: result.failed,
        skipped: result.skipped, errorMessage: errorMessage ?? null,
        completedAt: new Date(), leaseExpiresAt: null,
      },
    });
    if (claimed.count !== 1) return false;
    await tx.priceCheckJob.update({
      where: { id: item.jobId },
      data: {
        completedProductIds: { push: item.productId },
        checked: { increment: result.checked },
        changed: { increment: result.changed },
        pendingReview: { increment: result.pendingReview },
        failed: { increment: result.failed },
        skipped: { increment: result.skipped },
      },
    });
    await tx.jobLease.deleteMany({
      where: { storeId: item.storeId, jobType: "PRICE_CHECK_ITEM", jobId: item.id },
    });
    const remaining = await tx.priceCheckJobItem.count({
      where: { jobId: item.jobId, status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] } },
    });
    if (remaining === 0 || parent.status === PriceCheckJobStatus.CANCELLING) {
      const stillRunning = await tx.priceCheckJobItem.count({
        where: { jobId: item.jobId, status: "RUNNING" },
      });
      if (parent.status === PriceCheckJobStatus.CANCELLING && stillRunning > 0) {
        return true;
      }
      await tx.priceCheckJob.update({
        where: { id: item.jobId },
        data: { status: parent.status === PriceCheckJobStatus.CANCELLING
          ? PriceCheckJobStatus.CANCELLED : PriceCheckJobStatus.COMPLETED,
          completedAt: new Date() },
      });
    }
    return true;
  });
  if (completed) invalidateJobCaches(item.storeId);
  return completed;
}

export async function cancelItemScheduledJob(jobId: string, force: boolean) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.priceCheckJob.findUnique({ where: { id: jobId } });
    if (!initial?.storeId) return null;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${initial.storeId}`}))`;
    const job = await tx.priceCheckJob.findUnique({ where: { id: jobId } });
    const cancellableStatuses: PriceCheckJobStatus[] = [
      PriceCheckJobStatus.QUEUED,
      PriceCheckJobStatus.RUNNING,
      PriceCheckJobStatus.CANCELLING,
    ];
    if (!job || !cancellableStatuses.includes(job.status)) return job;
    const running = await tx.priceCheckJobItem.count({
      where: { jobId, status: "RUNNING", leaseExpiresAt: { gt: new Date() } },
    });
    const status = force || running === 0
      ? PriceCheckJobStatus.CANCELLED
      : PriceCheckJobStatus.CANCELLING;
    await tx.priceCheckJobItem.updateMany({
      where: { jobId, status: { in: ["PENDING", "RETRY_WAIT"] } },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    if (force) {
      const uncertain = await tx.priceCheckJobItem.findMany({
        where: { jobId, status: "RUNNING", remoteWriteStarted: true },
        select: { productId: true },
      });
      await tx.priceCheckJobItem.updateMany({
        where: { jobId, status: "RUNNING", remoteWriteStarted: false },
        data: { status: "CANCELLED", claimToken: null, completedAt: new Date() },
      });
      await tx.priceCheckJobItem.updateMany({
        where: { jobId, status: "RUNNING", remoteWriteStarted: true },
        data: { status: "FAILED", claimToken: null, completedAt: new Date(),
          checked: 1, failed: 1,
          errorMessage: "eBay outcome uncertain after force stop; reconcile before retry." },
      });
      if (uncertain.length > 0) {
        await tx.priceCheckJob.update({ where: { id: jobId }, data: {
          completedProductIds: { push: uncertain.map((item) => item.productId) },
          checked: { increment: uncertain.length },
          failed: { increment: uncertain.length },
        } });
      }
    }
    const updated = await tx.priceCheckJob.update({
      where: { id: jobId },
      data: { status, reason: force ? "Price check force-stopped."
        : "Stopping after current product...",
        completedAt: status === PriceCheckJobStatus.CANCELLED ? new Date() : null },
    });
    invalidateJobCaches(job.storeId ?? "");
    return updated;
  });
}

export async function runNextPriceCheckItemForStore(
  storeId: string,
  worker: WorkerContext,
  manualOnly = false,
) {
  if (!(await itemSchedulerEnabled(storeId))) return false;
  const item = await claimNextItem(storeId, worker, manualOnly);
  if (!item) return false;
  let leaseFailure: Error | null = null;
  const timer = setInterval(() => {
    void renew(item).catch((error) => {
      leaseFailure = error instanceof Error ? error : new Error(String(error));
      logger.error("price-check/items", "Item lease renewal failed", error,
        { storeId, itemId: item.id });
    });
  }, JOB_LEASE_RENEW_MS);
  const guard = async () => {
    if (leaseFailure) throw leaseFailure;
    await assertOwnership(item);
  };
  try {
    await guard();
    const result = await runPriceCheck({
      jobId: item.jobId, storeId, productIds: [item.productId],
      ignoreSchedule: true, assertOwnership: guard,
      beforeExternalWrite: async () => {
        await guard();
        const updated = await prisma.priceCheckJobItem.updateMany({
          where: { id: item.id, claimToken: item.token, status: "RUNNING",
            leaseExpiresAt: { gt: new Date() } },
          data: { remoteWriteStarted: true },
        });
        if (updated.count !== 1) throw new Error("Price-check claim was lost before eBay update.");
      },
      withExternalWrite: async (write) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await guard();
          try {
            return await withJobLeases(
              getEbayWriteLeaseInput(storeId, "PRICE_CHECK_PRICE", item.id, worker,
                "Price check listing revision", item.startedAt),
              async () => {
                await guard();
                return write();
              },
            );
          } catch (error) {
            if (!(error instanceof JobConflictError) || attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2_000));
          }
        }
        throw new Error("Could not acquire the eBay write lane.");
      },
      shouldCancel: async () => {
        await guard();
        return false;
      },
    });
    await guard();
    const normalized = result.checked === 0
      ? { ...result, checked: 1, skipped: result.skipped + 1 }
      : result;
    const [product, observation] = await Promise.all([
        prisma.product.findUnique({ where: { id: item.productId },
          select: { priceCheckError: true } }),
        prisma.amazonPriceObservation.findFirst({
          where: { productId: item.productId, observedAt: { gte: item.startedAt } },
          orderBy: { observedAt: "desc" }, select: { postcodeVerified: true },
        }),
    ]);
    if (await complete(item, normalized,
      normalized.failed > 0 ? product?.priceCheckError ?? "Price check failed." : undefined)) {
      try {
      if (normalized.failed > 0 && /post\s*code|delivery location/i.test(product?.priceCheckError ?? "")) {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${storeId}`}))`;
          const state = await tx.priceCheckScheduleState.findUniqueOrThrow({ where: { storeId } });
          const failures = state.consecutivePostcodeFailures + 1;
          const seconds = failures < 3 ? 0
            : state.amazonCooldownSeconds === 0 ? 60
              : Math.min(300, state.amazonCooldownSeconds * 2);
          await tx.priceCheckScheduleState.update({ where: { storeId }, data: {
            consecutivePostcodeFailures: failures,
            amazonCooldownSeconds: seconds,
            amazonBlockedUntil: seconds > 0
              ? new Date(Date.now() + seconds * 1000) : null,
          } });
        });
      } else if (observation?.postcodeVerified) {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${storeId}`}))`;
          await tx.priceCheckScheduleState.update({ where: { storeId }, data: {
            consecutivePostcodeFailures: 0, amazonCooldownSeconds: 0,
            amazonBlockedUntil: null,
          } });
        });
      }
      const hold = await queuePriceCheckAutoHoldForRun({
        userId: item.userId, storeId, productIds: [item.productId],
        failedSince: item.startedAt,
      }).catch((error) => {
        logger.error("price-check/items", "Could not queue hold or recovery", error,
          { storeId, itemId: item.id });
        return null;
      });
      if (hold?.queued) {
        await prisma.priceCheckJob.update({ where: { id: item.jobId }, data: {
          autoHoldQueued: { increment: hold.queued },
          autoHoldActionJobId: hold.actionJobId,
        } });
      }
      } catch (postCheckError) {
        logger.error("price-check/items", "Post-check processing failed", postCheckError,
          { storeId, itemId: item.id });
      }
    }
  } catch (error) {
    logger.error("price-check/items", "Product check failed", error,
      { storeId, itemId: item.id, productId: item.productId });
    // A failed operation may already have reached eBay. Keep it terminal for
    // review; never replay an uncertain write automatically.
    await complete(item, { checked: 1, changed: 0, pendingReview: 0,
      failed: 1, skipped: 0 }, error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(timer);
  }
  return true;
}
