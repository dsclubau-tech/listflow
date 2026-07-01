import "server-only";

import {
  EbayActionJobStatus,
  EbayImportJobStatus,
  EbayResearchBatchStatus,
  PriceCheckJobScope,
  PriceCheckJobStatus,
} from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const JOB_LEASE_TTL_MS = Number(
  process.env.LISTFLOW_WORKER_LEASE_TTL_MS ?? 90_000
);
export const JOB_LEASE_RENEW_MS = Math.max(
  5_000,
  Math.floor(JOB_LEASE_TTL_MS / 3)
);

const PRICE_CHECK_GATE_KEY = "price-check-products:gate";
const PRICE_CHECK_ALL_KEY = "price-check-products:all";
const PRICE_CHECK_PRODUCT_PREFIX = "price-check-products:product:";
const EBAY_GATE_KEY = "ebay-api:gate";
const EBAY_READ_KEY = "ebay-api-read";
const EBAY_WRITE_KEY = "ebay-api-write";

const ACTIVE_PRICE_CHECK_STATUSES: PriceCheckJobStatus[] = [
  PriceCheckJobStatus.QUEUED,
  PriceCheckJobStatus.RUNNING,
  PriceCheckJobStatus.CANCELLING,
];
const ACTIVE_IMPORT_STATUSES: EbayImportJobStatus[] = [
  EbayImportJobStatus.QUEUED,
  EbayImportJobStatus.RUNNING,
  EbayImportJobStatus.PAUSING,
  EbayImportJobStatus.PAUSED,
  EbayImportJobStatus.CANCELLING,
];
const ACTIVE_RESEARCH_BATCH_STATUSES: EbayResearchBatchStatus[] = [
  EbayResearchBatchStatus.QUEUED,
  EbayResearchBatchStatus.RUNNING,
  EbayResearchBatchStatus.PAUSING,
  EbayResearchBatchStatus.PAUSED,
];
const ACTIVE_ACTION_STATUSES: EbayActionJobStatus[] = [
  EbayActionJobStatus.QUEUED,
  EbayActionJobStatus.RUNNING,
];

type TransactionClient = Prisma.TransactionClient;

export type WorkerContext = {
  workerId: string;
  workerName: string;
};

type LeaseRecord = {
  id: string;
  storeId: string;
  resourceKey: string;
  jobType: string;
  jobId: string;
  workerId: string;
  workerName: string;
  details: Prisma.JsonValue;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
};

type LeaseInput = {
  storeId: string;
  jobType: string;
  jobId: string;
  worker: WorkerContext;
  resources: string[];
  details?: Prisma.InputJsonValue;
  gateKey?: string;
  conflictWhere?: Prisma.JobLeaseWhereInput;
};

export type SerializedJobLease = {
  id: string;
  storeId: string;
  resourceKey: string;
  jobType: string;
  jobId: string;
  workerId: string;
  workerName: string;
  details: Prisma.JsonValue;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
};

export class JobConflictError extends Error {
  conflicts: SerializedJobLease[];

  constructor(message: string, conflicts: LeaseRecord[] = []) {
    super(message);
    this.name = "JobConflictError";
    this.conflicts = conflicts.map(serializeJobLease);
  }
}

function leaseExpiresAt() {
  return new Date(Date.now() + JOB_LEASE_TTL_MS);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function serializeJobLease(lease: LeaseRecord): SerializedJobLease {
  return {
    id: lease.id,
    storeId: lease.storeId,
    resourceKey: lease.resourceKey,
    jobType: lease.jobType,
    jobId: lease.jobId,
    workerId: lease.workerId,
    workerName: lease.workerName,
    details: lease.details,
    acquiredAt: lease.acquiredAt.toISOString(),
    renewedAt: lease.renewedAt.toISOString(),
    expiresAt: lease.expiresAt.toISOString(),
  };
}

async function pruneExpiredLeases(tx: TransactionClient, now = new Date()) {
  await tx.jobLease.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}

async function withGate<T>(
  tx: TransactionClient,
  input: LeaseInput,
  run: () => Promise<T>
) {
  if (!input.gateKey) {
    return run();
  }

  const now = new Date();
  const gate = await tx.jobLease.create({
    data: {
      storeId: input.storeId,
      resourceKey: input.gateKey,
      jobType: "GATE",
      jobId: input.jobId,
      workerId: input.worker.workerId,
      workerName: input.worker.workerName,
      expiresAt: new Date(now.getTime() + 30_000),
      details: { gate: true },
    },
  });

  try {
    return await run();
  } finally {
    await tx.jobLease.delete({ where: { id: gate.id } }).catch(() => undefined);
  }
}

async function acquireJobLeases(input: LeaseInput) {
  const resources = unique(input.resources);

  if (resources.length === 0) {
    throw new JobConflictError("This job has no resources to claim.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await pruneExpiredLeases(tx, now);

      await withGate(tx, input, async () => {
        const conflicts = await tx.jobLease.findMany({
          where: {
            storeId: input.storeId,
            expiresAt: { gt: now },
            OR: [
              { resourceKey: { in: resources } },
              ...(input.conflictWhere ? [input.conflictWhere] : []),
            ],
          },
        });

        if (conflicts.length > 0) {
          throw new JobConflictError(
            buildConflictMessage(conflicts),
            conflicts
          );
        }

        await tx.jobLease.createMany({
          data: resources.map((resourceKey) => ({
            storeId: input.storeId,
            resourceKey,
            jobType: input.jobType,
            jobId: input.jobId,
            workerId: input.worker.workerId,
            workerName: input.worker.workerName,
            expiresAt: leaseExpiresAt(),
            details: input.details ?? {},
          })),
        });
      });
    });
  } catch (error) {
    if (error instanceof JobConflictError) {
      throw error;
    }

    throw new JobConflictError(
      "Another worker claimed an overlapping job at the same time."
    );
  }
}

function buildConflictMessage(conflicts: LeaseRecord[]) {
  const first = conflicts[0];
  if (!first) {
    return "Another job is already using this resource.";
  }

  if (first.resourceKey === EBAY_READ_KEY || first.resourceKey === EBAY_WRITE_KEY) {
    return `${first.workerName} is running an eBay job for this store. Wait for it to finish before starting another eBay job.`;
  }

  if (first.resourceKey === PRICE_CHECK_ALL_KEY) {
    return `${first.workerName} is running a full-store price check. Wait for it to finish or pause it first.`;
  }

  if (first.resourceKey.startsWith(PRICE_CHECK_PRODUCT_PREFIX)) {
    return `${first.workerName} is checking overlapping products. Choose different products or wait for that job to finish.`;
  }

  return `${first.workerName} is running an overlapping job.`;
}

async function releaseJobLeases(
  storeId: string,
  jobType: string,
  jobId: string,
  worker: WorkerContext
) {
  await prisma.jobLease.deleteMany({
    where: {
      storeId,
      jobType,
      jobId,
      workerId: worker.workerId,
    },
  });
}

async function renewJobLeases(
  storeId: string,
  jobType: string,
  jobId: string,
  worker: WorkerContext
) {
  const now = new Date();
  await prisma.jobLease.updateMany({
    where: {
      storeId,
      jobType,
      jobId,
      workerId: worker.workerId,
    },
    data: {
      renewedAt: now,
      expiresAt: leaseExpiresAt(),
    },
  });
}

export async function withJobLeases<T>(
  input: LeaseInput,
  run: () => Promise<T>
) {
  await acquireJobLeases(input);

  const renewal = setInterval(() => {
    void renewJobLeases(
      input.storeId,
      input.jobType,
      input.jobId,
      input.worker
    );
  }, JOB_LEASE_RENEW_MS);

  try {
    return await run();
  } finally {
    clearInterval(renewal);
    try {
      await releaseJobLeases(
        input.storeId,
        input.jobType,
        input.jobId,
        input.worker
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[WORKER LEASE RELEASE ERROR] ${message}\n`
      );
    }
  }
}

export function getPriceCheckLeaseInput(job: {
  id: string;
  storeId: string | null;
  scope: PriceCheckJobScope;
  productIds: string[];
  total: number;
}, worker: WorkerContext): LeaseInput | null {
  if (!job.storeId) {
    return null;
  }

  if (job.scope === PriceCheckJobScope.ALL) {
    return {
      storeId: job.storeId,
      jobType: "PRICE_CHECK",
      jobId: job.id,
      worker,
      gateKey: PRICE_CHECK_GATE_KEY,
      resources: [PRICE_CHECK_ALL_KEY],
      conflictWhere: {
        OR: [
          { resourceKey: PRICE_CHECK_ALL_KEY },
          { resourceKey: { startsWith: PRICE_CHECK_PRODUCT_PREFIX } },
        ],
      },
      details: {
        label: "Product price check",
        scope: job.scope,
        total: job.total,
      },
    };
  }

  return {
    storeId: job.storeId,
    jobType: "PRICE_CHECK",
    jobId: job.id,
    worker,
    gateKey: PRICE_CHECK_GATE_KEY,
    resources: job.productIds.map((id) => `${PRICE_CHECK_PRODUCT_PREFIX}${id}`),
    conflictWhere: { resourceKey: PRICE_CHECK_ALL_KEY },
    details: {
      label: "Product price check",
      scope: job.scope,
      total: job.total,
    },
  };
}

export function getEbayReadLeaseInput(
  storeId: string,
  jobType: string,
  jobId: string,
  worker: WorkerContext,
  label: string
): LeaseInput {
  return {
    storeId,
    jobType,
    jobId,
    worker,
    gateKey: EBAY_GATE_KEY,
    resources: [EBAY_READ_KEY],
    conflictWhere: {
      resourceKey: { in: [EBAY_READ_KEY, EBAY_WRITE_KEY] },
    },
    details: { label, lane: "eBay read" },
  };
}

export function getEbayWriteLeaseInput(
  storeId: string,
  jobType: string,
  jobId: string,
  worker: WorkerContext,
  label: string
): LeaseInput {
  return {
    storeId,
    jobType,
    jobId,
    worker,
    gateKey: EBAY_GATE_KEY,
    resources: [EBAY_WRITE_KEY],
    conflictWhere: {
      resourceKey: { in: [EBAY_READ_KEY, EBAY_WRITE_KEY] },
    },
    details: { label, lane: "eBay write" },
  };
}

export async function listActiveJobLeasesForStore(storeId: string) {
  const now = new Date();
  await prisma.jobLease.deleteMany({ where: { storeId, expiresAt: { lte: now } } });
  const leases = await prisma.jobLease.findMany({
    where: {
      storeId,
      expiresAt: { gt: now },
      NOT: { jobType: "GATE" },
    },
    orderBy: [{ workerName: "asc" }, { acquiredAt: "asc" }],
  });

  return leases.map(serializeJobLease);
}

export async function assertNoPriceCheckStartConflict(input: {
  storeId: string;
  scope: PriceCheckJobScope;
  productIds: string[];
}) {
  const activeJobs = await prisma.priceCheckJob.findMany({
    where: {
      storeId: input.storeId,
      status: { in: ACTIVE_PRICE_CHECK_STATUSES },
      dismissedAt: null,
    },
    select: {
      id: true,
      scope: true,
      productIds: true,
      total: true,
    },
  });

  if (input.scope === PriceCheckJobScope.ALL && activeJobs.length > 0) {
    throw new JobConflictError(
      "A product price check is already active. Pause it or wait for it to finish before starting a full-store check."
    );
  }

  const requested = new Set(input.productIds);
  const overlapping = activeJobs.find((job) => {
    if (job.scope === PriceCheckJobScope.ALL || input.scope === PriceCheckJobScope.ALL) {
      return true;
    }

    return job.productIds.some((productId) => requested.has(productId));
  });

  if (overlapping) {
    throw new JobConflictError(
      overlapping.scope === PriceCheckJobScope.ALL
        ? "A full-store price check is already active. Pause it or wait for it to finish before starting another check."
        : "Another price check already includes one or more of these products."
    );
  }

  const leases = await listActiveJobLeasesForStore(input.storeId);
  const conflictingLease = leases.find((lease) => {
    if (lease.resourceKey === PRICE_CHECK_ALL_KEY) {
      return true;
    }

    if (input.scope === PriceCheckJobScope.ALL) {
      return lease.resourceKey.startsWith(PRICE_CHECK_PRODUCT_PREFIX);
    }

    return input.productIds.some(
      (productId) => lease.resourceKey === `${PRICE_CHECK_PRODUCT_PREFIX}${productId}`
    );
  });

  if (conflictingLease) {
    throw new JobConflictError(
      `${conflictingLease.workerName} is already checking overlapping products.`
    );
  }
}

export async function assertNoEbayLaneStartConflict(
  storeId: string,
  lane: "read" | "write",
  options: { excludeResearchBatchId?: string } = {}
) {
  const [imports, researchBatches, actionJobs, leases] = await Promise.all([
    prisma.ebayImportJob.count({
      where: {
        storeId,
        status: { in: ACTIVE_IMPORT_STATUSES },
        dismissedAt: null,
      },
    }),
    prisma.ebayResearchBatch.count({
      where: {
        storeId,
        ...(options.excludeResearchBatchId
          ? { id: { not: options.excludeResearchBatchId } }
          : {}),
        status: { in: ACTIVE_RESEARCH_BATCH_STATUSES },
      },
    }),
    prisma.ebayActionJob.count({
      where: {
        storeId,
        status: { in: ACTIVE_ACTION_STATUSES },
        dismissedAt: null,
      },
    }),
    listActiveJobLeasesForStore(storeId),
  ]);

  const activeRead = imports + researchBatches > 0;
  const activeWrite = actionJobs > 0;
  const leaseConflict = leases.find(
    (lease) => lease.resourceKey === EBAY_READ_KEY || lease.resourceKey === EBAY_WRITE_KEY
  );

  if (leaseConflict) {
    throw new JobConflictError(
      `${leaseConflict.workerName} is running an eBay job for this store. Wait for it to finish before starting another eBay job.`
    );
  }

  if (lane === "read" && (activeRead || activeWrite)) {
    throw new JobConflictError(
      activeWrite
        ? "An eBay write action is already queued or running. Wait before starting eBay import or research."
        : "An eBay import or research job is already queued or running for this store."
    );
  }

  if (lane === "write" && (activeRead || activeWrite)) {
    throw new JobConflictError(
      activeRead
        ? "An eBay import or research job is already queued or running. Wait before changing live listings."
        : "An eBay write action is already queued or running for this store."
    );
  }
}
