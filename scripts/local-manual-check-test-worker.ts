/** Opt-in test worker: runs only the selected manual job received from the browser test. */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { normalizeAmazonPriceComparisonOutcome } from "../lib/amazon-price-comparison";
import { getPriceCheckFailureCode } from "../lib/price-check-failures";
import type { scrapeAmazonPrice } from "../lib/amazon-scraper";
import { resolvePriceCheckProductPacing } from "../lib/price-check-pacing";
import { resolvePriceCheckOptimizationConfig } from "../lib/price-check-optimizations";

type RecordedScrape = { asin: string; postcode: string | undefined; durationMs: number; outcome: ReturnType<typeof normalizeAmazonPriceComparisonOutcome> };
const recordedScrapes: RecordedScrape[] = [];

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const loader = Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (/(?:^|[/\\])amazon-scraper(?:\.ts)?$/.test(request) && loaded && typeof loaded === "object" && "scrapeAmazonPrice" in loaded) {
    const actual = (loaded as { scrapeAmazonPrice: typeof scrapeAmazonPrice }).scrapeAmazonPrice;
    // Record the actual response without mocking, editing, or replacing any verification or retry.
    return { ...loaded, scrapeAmazonPrice: async (...args: Parameters<typeof scrapeAmazonPrice>) => {
      const started = Date.now();
      try {
        const value = await actual(...args);
        recordedScrapes.push({ asin: args[0], postcode: args[2], durationMs: Date.now() - started, outcome: normalizeAmazonPriceComparisonOutcome({ kind: "result", value }) });
        return value;
      } catch (error) {
        recordedScrapes.push({ asin: args[0], postcode: args[2], durationMs: Date.now() - started, outcome: normalizeAmazonPriceComparisonOutcome({ kind: "error", code: getPriceCheckFailureCode(error), message: error instanceof Error ? error.message : String(error) }) });
        throw error;
      }
    } };
  }
  return loaded;
};

async function main() {
  if (process.env.LISTFLOW_RUN_LOCAL_MANUAL_CHECK_TEST !== "1" || !process.send) {
    throw new Error("Run this worker through the opt-in local manual-check browser test.");
  }
  if (!process.env.LISTFLOW_E2E_STORE_ID?.trim()) throw new Error("An explicit store login is required.");
  const origin = new URL(process.env.LISTFLOW_E2E_BASE_URL || "http://localhost:3001");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Local test URL required.");
  const expectedAsins = (process.env.LISTFLOW_E2E_PRODUCT_ASINS || "B0B4ZSR2PX,B0029U2YSA").split(",").map(x => x.trim());
  if (![2, 3, 5].includes(expectedAsins.length) || new Set(expectedAsins).size !== expectedAsins.length || expectedAsins.some(x => !/^[A-Z0-9]{10}$/.test(x))) {
    throw new Error("This test requires two, three, or five distinct ASINs; this is not a production bulk limit.");
  }
  const worker = { workerId: `local-manual-test-${randomUUID()}`, workerName: "Local selected manual-check test", workerRole: "store-specific" as const };
  process.env.LISTFLOW_WORKER_PROCESS = "true";
  process.env.LISTFLOW_WORKER_ID = worker.workerId;
  process.env.LISTFLOW_WORKER_NAME = worker.workerName;
  process.env.LISTFLOW_USE_LOCAL_PLAYWRIGHT = "true";
  const reuseMode = process.env.LISTFLOW_LOCAL_MANUAL_TEST_DELIVERY_STATE || "off";
  if (!["off", "on"].includes(reuseMode)) throw new Error("Test delivery state must be off or on.");
  // Only this child process changes configuration. Other optimizations remain off in both arms.
  process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = reuseMode === "on" ? "allowlist" : "off";
  process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = reuseMode === "on" ? "delivery-state" : "";
  process.env.LISTFLOW_PRICE_CHECK_TIMING_ENABLED = "true";
  process.env.LISTFLOW_REVISION = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { prisma } = await import("../lib/prisma");
  const { touchWorkerHeartbeat, WORKER_HEARTBEAT_INTERVAL_MS } = await import("../lib/worker-heartbeat");
  const { runPriceCheckJob, getPriceCheckJobForStore } = await import("../lib/price-check-jobs");
  const { assertWorkerSchemaReady } = await import("../lib/worker-schema-check");
  const { readLogEntries } = await import("../lib/logger");
  const startedAt = new Date();
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = Promise.resolve();
  let storeId: string | undefined;
  try {
    await assertWorkerSchemaReady(prisma);
    const store = await prisma.store.findFirst({ where: { loginId: process.env.LISTFLOW_E2E_STORE_ID, isActive: true } });
    if (!store) throw new Error("Configured store not found.");
    storeId = store.id;
    process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS = store.id;
    process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS = store.id;
    process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS = "";
    const optimization = resolvePriceCheckOptimizationConfig(storeId);
    if (optimization.deliveryStateEnabled !== (reuseMode === "on")) throw new Error("Effective delivery-state configuration does not match the requested test arm.");
    if (store.priceCheckItemSchedulerEnabled) throw new Error("This one-job test helper requires the version-1 scheduler; use the assigned worker for version 2.");
    const online = await prisma.workerHeartbeat.count({ where: { storeId, lastSeenAt: { gt: new Date(Date.now() - 60_000) } } });
    const active = await prisma.priceCheckJob.count({ where: { storeId, status: { in: ["QUEUED", "RUNNING", "CANCELLING"] } } });
    const leases = await prisma.jobLease.count({ where: { storeId, expiresAt: { gt: new Date() } } });
    if (online || active || leases) throw new Error("Another worker or job is active for this store. Finish that work before the local test.");
    if (store.ownerUserId) {
      const { getOrRefreshEntitlement } = await import("../lib/aa-entitlement");
      const entitlement = await getOrRefreshEntitlement(store.ownerUserId);
      const ownerStores = await prisma.store.findMany({ where: { ownerUserId: store.ownerUserId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const rank = ownerStores.findIndex(x => x.id === storeId) + 1;
      if (entitlement.status !== "ACTIVE" || rank < 1 || rank > entitlement.allowedStores) throw new Error("The normal worker entitlement check did not allow this store.");
    }
    const heartbeat = () => touchWorkerHeartbeat({ storeId: store.id, ...worker, startedAt, revision: process.env.LISTFLOW_REVISION }).then(() => {});
    await heartbeat();
    timer = setInterval(() => { heartbeatPending = heartbeatPending.then(heartbeat); heartbeatPending.catch(() => {}); }, WORKER_HEARTBEAT_INTERVAL_MS);
    const sourceHashes = Object.fromEntries(["lib/amazon-scraper.ts", "lib/price-checker.ts", "lib/price-check-jobs.ts", "lib/amazon-delivery-recovery.ts", "lib/amazon-delivery-cooldown.ts"].map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
    process.send!({ type: "ready", storeId, workerId: worker.workerId, revision: process.env.LISTFLOW_REVISION, sourceHashes, reuseMode, optimization, pacing: resolvePriceCheckProductPacing() });
    const input = await new Promise<{ jobId: string; productIds: string[] }>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("No manual job received from the browser test.")), 120_000);
      process.once("message", message => {
        clearTimeout(deadline);
        const value = message as { jobId?: unknown; productIds?: unknown };
        if (typeof value?.jobId !== "string" || !Array.isArray(value.productIds) || value.productIds.some(id => typeof id !== "string")) reject(new Error("Invalid browser-test job reference."));
        else resolve(value as { jobId: string; productIds: string[] });
      });
    });
    const job = await prisma.priceCheckJob.findUnique({ where: { id: input.jobId } });
    const selectedIds = new Set(input.productIds);
    if (!job || job.storeId !== storeId || job.scope !== "SELECTED" || job.trigger !== "MANUAL" || job.status !== "QUEUED" || job.schedulerVersion !== 1 || job.total !== expectedAsins.length || job.productIds.length !== selectedIds.size || !job.productIds.every(id => selectedIds.has(id)) || job.createdAt < startedAt) {
      throw new Error("Refusing a job outside this browser test's exact selection.");
    }
    const select = { id: true, asin: true, title: true, amazonPrice: true, amazonPriceTrackingMode: true, lastPriceCheck: true, priceCheckFailureCode: true, priceCheckError: true, status: true } as const;
    const before = await prisma.product.findMany({ where: { storeId, id: { in: job.productIds } }, select });
    if (before.length !== expectedAsins.length || !before.every(x => expectedAsins.includes(x.asin || ""))) throw new Error("Selected products do not match the test ASINs.");
    const runStarted = new Date();
    await runPriceCheckJob(job.id, worker);
    const runElapsedMs = Date.now() - runStarted.getTime();
    const after = await prisma.product.findMany({ where: { storeId, id: { in: job.productIds } }, select });
    const observations = await prisma.amazonPriceObservation.findMany({ where: { storeId, productId: { in: job.productIds }, observedAt: { gte: runStarted } }, select: {
      productId: true, requestedAsin: true, selectedAsin: true, identityOutcome: true, buyBoxOutcome: true, verifiedPostcode: true, postcodeVerified: true, price: true, regularPrice: true, dealPrice: true, priceMode: true, failureCode: true, message: true, isSuccessful: true, observedAt: true, stockLeft: true, availability: true, acceptedPriceSource: true,
    }, orderBy: { observedAt: "asc" } });
    process.send!({ type: "result", runElapsedMs, recordedScrapes, timing: readLogEntries().filter(entry => entry.context === "price-checker/timing" && (entry.data as { jobId?: string })?.jobId === job.id).map(entry => entry.data), deliveryReuse: readLogEntries().filter(entry => entry.context === "price-checker/delivery-state" && (entry.data as { jobId?: string })?.jobId === job.id).map(entry => entry.data), job: await getPriceCheckJobForStore(job.id, storeId), completedProductIds: (await prisma.priceCheckJob.findUniqueOrThrow({ where: { id: job.id }, select: { completedProductIds: true } })).completedProductIds, before, after, observations });
  } finally {
    if (timer) clearInterval(timer);
    await heartbeatPending.catch(() => {});
    if (storeId) await prisma.workerHeartbeat.deleteMany({ where: { storeId, workerId: worker.workerId } });
    await prisma.$disconnect();

  }
}
main().then(() => process.disconnect?.()).catch(error => {
  const message = error instanceof Error ? error.message : "Local test worker failed.";
  if (process.connected) process.send?.({ type: "error", message }, () => process.disconnect?.());
  process.exitCode = 1;
});
