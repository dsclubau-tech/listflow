import "server-only";

import { prisma } from "@/lib/prisma";
import {
  listActiveJobLeasesForStore,
  type SerializedJobLease,
} from "@/lib/job-coordination";
import type { WorkerRole } from "@/lib/worker-routing";

export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
export const WORKER_STALE_AFTER_MS = 60_000;
export const WORKER_CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours — hide workers not seen since
export const WORKER_OFFLINE_MESSAGE =
  "Worker offline. Open Start ListFlow Worker on a trusted PC to run price checks, imports, research batches, or quantity changes.";

export type SerializedWorkerStatus = {
  online: boolean;
  workerId: string | null;
  workerName: string | null;
  workerRole: WorkerRole;
  lastSeenAt: string | null;
  staleAfterSeconds: number;
  message: string | null;
  currentJobs: SerializedJobLease[];
};

type WorkerHeartbeatInput = {
  storeId: string;
  workerId: string;
  workerName: string;
  workerRole: WorkerRole;
  startedAt: Date;
  version?: string | null;
};

function serializeWorkerStatus(
  heartbeat:
    | {
        workerId: string;
        workerName: string;
        workerRole: string;
        lastSeenAt: Date;
      }
    | null,
  currentJobs: SerializedJobLease[] = []
): SerializedWorkerStatus {
  const online =
    heartbeat !== null &&
    Date.now() - heartbeat.lastSeenAt.getTime() <= WORKER_STALE_AFTER_MS;

  return {
    online,
    workerId: heartbeat?.workerId ?? null,
    workerName: heartbeat?.workerName ?? null,
    workerRole: normalizeWorkerRole(heartbeat?.workerRole),
    lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null,
    staleAfterSeconds: Math.round(WORKER_STALE_AFTER_MS / 1000),
    message: online ? null : WORKER_OFFLINE_MESSAGE,
    currentJobs,
  };
}

export function getOfflineWorkerStatus(
  message = WORKER_OFFLINE_MESSAGE
): SerializedWorkerStatus {
  return {
    online: false,
    workerId: null,
    workerName: null,
    workerRole: "legacy",
    lastSeenAt: null,
    staleAfterSeconds: Math.round(WORKER_STALE_AFTER_MS / 1000),
    message,
    currentJobs: [],
  };
}

export async function touchWorkerHeartbeat(input: WorkerHeartbeatInput) {
  const now = new Date();

  return prisma.workerHeartbeat.upsert({
    where: {
      storeId_workerId: {
        storeId: input.storeId,
        workerId: input.workerId,
      },
    },
    create: {
      storeId: input.storeId,
      workerId: input.workerId,
      workerName: input.workerName,
      workerRole: input.workerRole,
      status: "ONLINE",
      startedAt: input.startedAt,
      lastSeenAt: now,
      version: input.version ?? null,
    },
    update: {
      workerName: input.workerName,
      workerRole: input.workerRole,
      status: "ONLINE",
      lastSeenAt: now,
      version: input.version ?? null,
    },
  });
}

export async function getWorkerStatusForStore(storeId: string) {
  const workers = await getWorkerStatusesForStore(storeId);
  return (
    workers.find((worker) => worker.online) ??
    workers[0] ??
    getOfflineWorkerStatus()
  );
}

export async function getWorkerStatusesForStore(storeId: string) {
  const cleanupCutoff = new Date(Date.now() - WORKER_CLEANUP_AFTER_MS);
  const heartbeats = await prisma.workerHeartbeat.findMany({
    where: { storeId, lastSeenAt: { gt: cleanupCutoff } },
    orderBy: { lastSeenAt: "desc" },
    take: 10,
    select: {
      workerId: true,
      workerName: true,
      workerRole: true,
      lastSeenAt: true,
    },
  });
  const leases = await listActiveJobLeasesForStore(storeId);
  const leasesByWorker = new Map<string, SerializedJobLease[]>();

  for (const lease of leases) {
    const existing = leasesByWorker.get(lease.workerId) ?? [];
    existing.push(lease);
    leasesByWorker.set(lease.workerId, existing);
  }

  return heartbeats.map((heartbeat) =>
    serializeWorkerStatus(heartbeat, leasesByWorker.get(heartbeat.workerId) ?? [])
  );
}

function normalizeWorkerRole(value: string | null | undefined): WorkerRole {
  return value === "unified" || value === "store-specific" ? value : "legacy";
}

export async function isWorkerOnlineForStore(storeId: string) {
  const status = await getWorkerStatusForStore(storeId);
  return status.online;
}

export async function assertWorkerOnlineForStore(storeId: string) {
  const status = await getWorkerStatusForStore(storeId);

  if (!status.online) {
    const error = new Error(WORKER_OFFLINE_MESSAGE);
    error.name = "WorkerOfflineError";
    throw error;
  }

  return status;
}
