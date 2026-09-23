import assert from "node:assert/strict";
import Module from "node:module";
import test, { beforeEach } from "node:test";
import type { ActionCenterData } from "@/lib/action-center";

type FakeJob = {
  id: string;
  storeId: string;
  status: string;
  type: string;
  productIds: string[];
  completedProductIds: string[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: unknown[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};
type Where = { id?: string; storeId?: string; status?: string | { in: string[] } };
let job: FakeJob;
let beforeClaim: (() => Promise<void>) | null;
let beforeComplete: (() => Promise<void>) | null;
let duringSync: (() => Promise<void>) | null;
let duringDelete: (() => Promise<void>) | null;
let campaignCreates: number;
let writes: Array<{ operation: string; ids: string[] }>;
let authenticated = true;
let sessionStoreId = "store-1";

function matches(where: Where) {
  return (!where.id || where.id === job.id) &&
    (!where.storeId || where.storeId === job.storeId) &&
    (!where.status || (typeof where.status === "string"
      ? where.status === job.status : where.status.in.includes(job.status)));
}

const prisma = {
  ebayActionJob: {
    async findFirst({ where }: { where: Where }) {
      return matches(where) ? structuredClone(job) : null;
    },
    async findUnique({ where }: { where: Where }) {
      return matches(where) ? structuredClone(job) : null;
    },
    async findMany({ where }: { where: Where }) {
      return matches(where) ? [structuredClone(job)] : [];
    },
    async updateMany({ where, data }: { where: Where; data: Record<string, unknown> }) {
      if (data.status === "RUNNING" && beforeClaim) {
        const hook = beforeClaim;
        beforeClaim = null;
        await hook();
      }
      if (data.status === "COMPLETED" && beforeComplete) {
        const hook = beforeComplete;
        beforeComplete = null;
        await hook();
      }
      if (!matches(where)) return { count: 0 };
      Object.assign(job, data);
      return { count: 1 };
    },
    async update({ data }: { data: Record<string, unknown> }) {
      const { completedProductIds, ...rest } = data;
      Object.assign(job, rest);
      if (completedProductIds) job.completedProductIds = (completedProductIds as { set: string[] }).set;
      return structuredClone(job);
    },
  },
  product: {
    async findMany({ where }: { where: { id: { in: string[] } } }) {
      return where.id.in.map((id) => ({ id, title: id, ebayItemId: id, status: "IMPORTED" }));
    },
    async update() { return {}; },
  },
};

const stubs: Record<string, unknown> = {
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/auth": { auth: async () => authenticated ? { user: { id: "user-1" } } : null },
  "@/lib/store-session": { getCurrentStoreSession: async () => ({ storeId: sessionStoreId }) },
  "@/lib/prisma": { prisma },
  "@/lib/cache-tags": { invalidateJobCaches() {}, invalidateProductCaches() {} },
  "@/lib/logger": { logger: { error() {}, warn() {} } },
  "@/lib/worker-claim-policy": { filterRunnableJobsForWorker: (jobs: unknown[]) => jobs },
  "@/lib/ebay": {
    async getStoreNumber() { return 1; },
    async getEbayPromotedListingsEligibility() { return { eligible: true }; },
    async getEbayPromotedListingSync(_store: number, ids: string[]) {
      await duringSync?.();
      return new Map(ids.map((id) => [id, {
        campaignId: "old-campaign", campaignName: "Old", rateStrategy: "FIXED", bidPercentage: 2,
      }]));
    },
    async getEbayGeneralCampaign() {
      return { supported: true, campaignName: "Target", rateStrategy: "FIXED" };
    },
    async createEbayGeneralCampaign() {
      campaignCreates += 1;
      return { campaignId: "target-campaign", campaignName: "Target" };
    },
    async deleteEbayPromotedAds(_store: number, _campaign: string, ids: string[]) {
      writes.push({ operation: "delete", ids });
      await duringDelete?.();
      return ids.map((listingId) => ({ listingId, success: true }));
    },
    async createEbayPromotedAds(_store: number, _campaign: string, ids: string[]) {
      writes.push({ operation: "create", ids });
      return ids.map((listingId) => ({ listingId, success: true }));
    },
  },
};

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request in stubs) return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};

beforeEach(() => {
  job = {
    id: "job-1", storeId: "store-1", status: "QUEUED", type: "MANAGE_PROMOTED_ADS",
    productIds: Array.from({ length: 41 }, (_, index) => `product-${index}`),
    completedProductIds: [], total: 41, processed: 0, succeeded: 0, failed: 0, errors: [],
    metadata: { kind: "promoted-ads", operation: "REMOVE" },
    createdAt: new Date(), startedAt: null, completedAt: null,
  };
  beforeClaim = beforeComplete = duringSync = duringDelete = null;
  campaignCreates = 0;
  writes = [];
  authenticated = true;
  sessionStoreId = "store-1";
});

async function cancel() {
  const { cancelEbayActionJob } = await import("./ebay-action-cancellation");
  return cancelEbayActionJob(job.id, job.storeId);
}

async function runWorker() {
  const { runNextEbayActionJobForStore } = await import("./ebay-action-jobs");
  return runNextEbayActionJobForStore(job.storeId);
}

test("queued cancellation is immediate, idempotent, and prevents worker execution", async () => {
  await cancel();
  const completedAt = job.completedAt;
  await cancel();
  assert.equal(job.status, "CANCELLED");
  assert.equal(job.completedAt, completedAt);
  assert.equal(await runWorker(), false);
  assert.deepEqual(writes, []);
});

test("cancellation is scoped to the authenticated store and preserves terminal jobs", async () => {
  const { cancelEbayActionJob } = await import("./ebay-action-cancellation");
  assert.equal(await cancelEbayActionJob(job.id, "another-store"), null);
  assert.equal(job.status, "QUEUED");
  assert.equal(await cancelEbayActionJob("missing", job.storeId), null);
  for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
    job.status = status;
    await cancel();
    assert.equal(job.status, status);
  }
});

test("running cancellation waits for the worker to acknowledge it", async () => {
  job.status = "RUNNING";
  await cancel();
  assert.equal(job.status, "CANCELLING");
  assert.equal(job.completedAt, null);
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.ok(job.completedAt);
  assert.deepEqual(writes, []);
});

test("a cancellation racing a worker claim cannot restart the job", async () => {
  beforeClaim = async () => { await cancel(); };
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.deepEqual(writes, []);
});

test("a worker claim racing cancellation requests a graceful stop", async () => {
  const originalUpdateMany = prisma.ebayActionJob.updateMany;
  prisma.ebayActionJob.updateMany = async (args) => {
    if (args.where.status === "QUEUED") job.status = "RUNNING";
    return originalUpdateMany(args);
  };
  try {
    await cancel();
    assert.equal(job.status, "CANCELLING");
    assert.equal(job.completedAt, null);
  } finally {
    prisma.ebayActionJob.updateMany = originalUpdateMany;
  }
});

test("cancellation during promotion reads prevents subsequent eBay writes", async () => {
  duringSync = async () => { await cancel(); };
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.equal(job.processed, 0);
  assert.equal(job.failed, 0);
  assert.deepEqual(writes, []);
});

test("cancellation finishes the current promotion batch and preserves its progress", async () => {
  duringDelete = async () => { await cancel(); };
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.equal(job.processed, 20);
  assert.equal(job.succeeded, 20);
  assert.equal(job.failed, 0);
  assert.equal(job.completedProductIds.length, 20);
  assert.equal(writes.length, 1);
});

test("cancellation completes an in-flight campaign move before stopping", async () => {
  job.metadata = { operation: "APPLY", campaignMode: "EXISTING", campaignId: "target-campaign", bidPercentage: 3 };
  duringDelete = async () => { await cancel(); };
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.equal(job.succeeded, 20);
  assert.deepEqual(writes.map((write) => write.operation), ["delete", "create"]);
  assert.deepEqual(writes[0].ids, writes[1].ids);
});

test("promotion batches reuse a created campaign and process all products without cancellation", async () => {
  job.metadata = { operation: "APPLY", campaignMode: "CREATE", campaignName: "Target", bidPercentage: 3 };
  await runWorker();
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.processed, 41);
  assert.equal(job.succeeded, 41);
  assert.equal(campaignCreates, 1);
});

test("a cancellation racing completion is never overwritten as completed", async () => {
  beforeComplete = async () => { await cancel(); };
  await runWorker();
  assert.equal(job.status, "CANCELLED");
  assert.equal(job.processed, 41);
});

test("cancel endpoint rejects unauthenticated and cross-store requests", async () => {
  const { POST } = await import("../app/api/ebay-action/jobs/[id]/cancel/route");
  const request = new Request("http://localhost/api/ebay-action/jobs/job-1/cancel", { method: "POST" });
  const params = Promise.resolve({ id: job.id });
  authenticated = false;
  assert.equal((await POST(request, { params })).status, 401);
  assert.equal(job.status, "QUEUED");
  authenticated = true;
  sessionStoreId = "another-store";
  assert.equal((await POST(request, { params })).status, 404);
  assert.equal(job.status, "QUEUED");
  sessionStoreId = job.storeId;
  const response = await POST(request, { params });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { job: { id: job.id, status: "CANCELLED" } });
});

test("Action Center renders cancellation controls for both running and queued eBay jobs", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: ActionCenterClient } = await import("../components/ActionCenterClient");
  const { getOfflineWorkerStatus } = await import("./worker-heartbeat");
  const data: ActionCenterData = {
    worker: getOfflineWorkerStatus(), workers: [],
    summary: { pendingReviews: 0, failedChecks: 0, lowStock: 0, onHold: 0, runningJobs: 2 },
    queues: { pendingReviews: [], failedChecks: [], lowStock: [], onHold: [] },
    jobs: {
      priceChecks: [], ebayImports: [], ebayResearchBatches: [],
      ebayActions: (["RUNNING", "QUEUED", "CANCELLING"] as const).map((status, index) => ({
        id: `action-${index}`, storeId: job.storeId, type: job.type, status,
        total: 20, processed: 0, succeeded: 0, failed: 0, errorMessage: null,
        createdAt: job.createdAt.toISOString(), updatedAt: job.createdAt.toISOString(),
        startedAt: null, completedAt: null, dismissedAt: null, queuePosition: index + 1,
      })),
    },
  };
  const markup = renderToStaticMarkup(createElement(ActionCenterClient, { data }));
  const cancelButtons = markup.match(/<button[^>]*>Cancel<\/button>/g) ?? [];
  assert.equal(cancelButtons.length, 2);
  assert.ok(cancelButtons.every((button) => !button.includes(' disabled=""')));
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Cancelling\.\.\.<\/button>/);
  assert.match(markup, /Cancelling - finishing current operation/);
});
