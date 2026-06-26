import "server-only";

import { prisma } from "@/lib/prisma";
import {
  listActiveJobLeasesForStore,
  type SerializedJobLease,
} from "@/lib/job-coordination";

export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
export const WORKER_STALE_AFTER_MS = 60_000;
export const WORKER_OFFLINE_MESSAGE =
  "Worker offline. Open Start ListFlow Worker on a trusted PC to run price checks, imports, research batches, or quantity changes.";

export type SerializedWorkerStatus = {
  online: boolean;
  workerId: string | null;
  workerName: string | null;
  lastSeenAt: string | null;
  staleAfterSeconds: number;
  message: string | null;
  currentJobs: SerializedJobLease[];
};

type WorkerHeartbeatInput = {
  storeId: string;
  workerId: string;
  workerName: string;
  startedAt: Date;
  version?: string | null;
};

function serializeWorkerStatus(
  heartbeat:
    | {
        workerId: string;
        workerName: string;
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
    lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null,
    staleAfterSeconds: Math.round(WORKER_STALE_AFTER_MS / 1000),
    message: online ? null : WORKER_OFFLINE_MESSAGE,
    currentJobs,
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
      status: "ONLINE",
      startedAt: input.startedAt,
      lastSeenAt: now,
      version: input.version ?? null,
    },
    update: {
      workerName: input.workerName,
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
    serializeWorkerStatus(null)
  );
}

export async function getWorkerStatusesForStore(storeId: string) {
  const [heartbeats, leases] = await Promise.all([
    prisma.workerHeartbeat.findMany({
      where: { storeId },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
      select: {
        workerId: true,
        workerName: true,
        lastSeenAt: true,
      },
    }),
    listActiveJobLeasesForStore(storeId),
  ]);
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
