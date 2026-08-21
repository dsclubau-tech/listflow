import "server-only";

import { prisma } from "@/lib/prisma";
import type { WorkerContext } from "@/lib/job-coordination";
import {
  DEFAULT_WORKER_CLAIM_GRACE_MS,
  parsePositiveWorkerMs,
  shouldDeferQueuedJob,
} from "@/lib/worker-routing";

const SPECIALIST_STALE_AFTER_MS = 60_000;
const ONLINE_SPECIALIST_CACHE_MS = 1_000;
const OFFLINE_SPECIALIST_CACHE_MS = 100;

const specialistCache = new Map<
  string,
  { checkedAt: number; online: boolean }
>();

export type WorkerClaimPolicy = {
  graceMs: number;
  specialistOnline: boolean;
  checkedAt: Date;
};

async function isStoreSpecialistOnline(storeId: string, now: Date) {
  const cached = specialistCache.get(storeId);
  const cacheMs = cached?.online
    ? ONLINE_SPECIALIST_CACHE_MS
    : OFFLINE_SPECIALIST_CACHE_MS;
  if (cached && now.getTime() - cached.checkedAt < cacheMs) {
    return cached.online;
  }

  const heartbeat = await prisma.workerHeartbeat.findFirst({
    where: {
      storeId,
      workerRole: "store-specific",
      lastSeenAt: {
        gt: new Date(now.getTime() - SPECIALIST_STALE_AFTER_MS),
      },
    },
    select: { id: true },
  });
  const online = Boolean(heartbeat);
  specialistCache.set(storeId, { checkedAt: now.getTime(), online });
  return online;
}

export async function getWorkerClaimPolicy(
  storeId: string,
  worker: WorkerContext,
  now = new Date(),
): Promise<WorkerClaimPolicy> {
  const graceMs = parsePositiveWorkerMs(
    process.env.LISTFLOW_WORKER_CLAIM_GRACE_MS,
    DEFAULT_WORKER_CLAIM_GRACE_MS,
  );

  return {
    graceMs,
    specialistOnline:
      worker.workerRole === "unified"
        ? await isStoreSpecialistOnline(storeId, now)
        : false,
    checkedAt: now,
  };
}

export function filterRunnableJobsForWorker<
  T extends { status: string; createdAt: Date },
>(
  jobs: T[],
  worker: WorkerContext | undefined,
  policy: WorkerClaimPolicy | null,
  queuedStatus = "QUEUED",
) {
  if (!worker || !policy) {
    return jobs;
  }

  return jobs.filter(
    (job) =>
      job.status !== queuedStatus ||
      !shouldDeferQueuedJob({
        workerRole: worker.workerRole,
        specialistOnline: policy.specialistOnline,
        createdAt: job.createdAt,
        now: policy.checkedAt,
        graceMs: policy.graceMs,
      }),
  );
}

export function clearWorkerClaimPolicyCache() {
  specialistCache.clear();
}
