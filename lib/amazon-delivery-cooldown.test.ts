import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Prisma } from "@/app/generated/prisma/client";
import type * as Cooldown from "./amazon-delivery-cooldown";
import type { runPriceCheck } from "./price-checker";
import type { runPriceCheckJob, runNextPriceCheckJobForStore, createPriceCheckJob } from "./price-check-jobs";
import type { runNextPriceCheckItemForStore, cancelItemScheduledJob } from "./price-check-item-scheduler";
import type { PriceCheckFailure } from "./price-check-failures";
import type { AmazonDeliveryFailure } from "./amazon-delivery-recovery";

type Row = Record<string, unknown>;
type Query = { where?: Row; data?: Row; orderBy?: Row | Row[]; take?: number };
const compiled = build({ stdin: { resolveDir: process.cwd(), contents: `
  export * from "./lib/amazon-delivery-cooldown";
  export { PriceCheckFailure } from "./lib/price-check-failures";
  export { AmazonDeliveryFailure } from "./lib/amazon-delivery-recovery";
  export { runPriceCheck } from "./lib/price-checker";
  export { runPriceCheckJob, runNextPriceCheckJobForStore, createPriceCheckJob } from "./lib/price-check-jobs";
  export { runNextPriceCheckItemForStore, cancelItemScheduledJob } from "./lib/price-check-item-scheduler";
` }, bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "isolated-database", setup(builder) {
    builder.onResolve({ filter: /^(server-only|(?:@\/lib\/|\.\/)(?:prisma|cache-tags|logger|amazon-scraper|scraper-browser|price-check-auto-hold|ebay|worker-claim-policy)|@\/app\/generated\/prisma\/client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
      args.path === "server-only" ? "" : args.path.endsWith("/prisma") ? "export const prisma = globalThis.database;"
      : args.path.endsWith("/client") ? "export const Prisma = globalThis.Prisma;"
      : args.path.endsWith("cache-tags") ? "export const invalidatePriceCaches = () => {}; export const invalidateJobCaches = () => {};"
      : args.path.endsWith("logger") ? "export const logger = { info(){}, warn(){}, error(){}, debug(){} };"
      : args.path.endsWith("amazon-scraper") ? "export const scrapeAmazonPrice = (...args) => globalThis.scrape(...args);"
      : args.path.endsWith("scraper-browser") ? "export const launchScraperBrowser = async () => ({isConnected:()=>true,close:async()=>{}}); export const getBrowserLaunchUserMessage = () => null;"
       : args.path.endsWith("ebay") ? "export const getStoreNumber = async () => '1'; export const callEbayReviseInventoryStatus = (...args) => globalThis.ebay(...args);"
      : args.path.endsWith("worker-claim-policy") ? "export const getWorkerClaimPolicy = async () => ({}); export const filterRunnableJobsForWorker = jobs => jobs;"
      : "export const finalizePriceCheckAutoHoldForJob = async () => ({queued:0,actionJobId:null}); export const queuePriceCheckAutoHoldForRun = async () => ({queued:0});"
    }));
  } }],
}).then(result => result.outputFiles[0].text);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some(part => matches(row, part));
    if (key === "NOT") return !matches(row, condition as Row);
    if (key === "storeId_resourceKey" || key === "storeId_supplierName") return matches(row, condition as Row);
    const actual = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const comparison = condition as Row;
      if ("not" in comparison) return actual !== comparison.not;
      if ("in" in comparison) return (comparison.in as unknown[]).includes(actual);
      if ("gt" in comparison) return actual != null && Number(actual) > Number(comparison.gt);
      if ("gte" in comparison) return actual != null && Number(actual) >= Number(comparison.gte);
      if ("lte" in comparison) return actual != null && Number(actual) <= Number(comparison.lte);
      if ("lt" in comparison) return actual != null && Number(actual) < Number(comparison.lt);
      if ("startsWith" in comparison) return String(actual).startsWith(String(comparison.startsWith));
      if ("has" in comparison) return (actual as unknown[]).includes(comparison.has);
      return !!actual && typeof actual === "object" && matches(actual as Row, comparison);
    }
    return actual instanceof Date && condition instanceof Date ? actual.getTime() === condition.getTime() : actual === condition;
  });
}
function update(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const operation = value as Row;
      if ("increment" in operation) { row[key] = Number(row[key] ?? 0) + Number(operation.increment); continue; }
      if ("push" in operation) { row[key] = [...row[key] as unknown[], ...[operation.push].flat()]; continue; }
      if ("set" in operation) { row[key] = operation.set; continue; }
    }
    row[key] = value;
  }
  row.updatedAt = new Date();
}
async function fixture(count = 809, version = 1, finished = 0) {
  const now = new Date();
  const ids = Array.from({ length: count }, (_, i) => `product-${i}`);
  const tables: Record<string, Row[]> = {
    priceCheckScheduleState: [], jobLease: [], amazonPriceObservation: [], priceHistory: [], listingOperation: [], variant: [], user: [{id:"user-a"}],
    store: [{ id: "store-a", priceCheckItemSchedulerEnabled: version === 2 }],
    supplierSettings: [{ storeId: "store-a", supplierName: "Amazon AU", scrapePostcode: "2217", minProductQuantity: 1, priceTrackingEnabled: true }],
    product: ids.map(id => ({ id, storeId: "store-a", asin: "B0G6CQ427S", status: "IMPORTED", amazonPriceTrackingMode: "REGULAR",
      variants: [{ id: `${id}-variant`, buyPrice: 100, sellPrice: 120 }], store: {}, amazonPrice: 100, price: 120, ebayItemId: "123456789012", quantity: 1, holdLastObservationId: null, lastPriceCheck: null, itemSpecifics: {}, _count: {variants: 1} })),
    priceCheckJob: [{ id: "job-a", storeId: "store-a", userId: "user-a", status: "QUEUED", schedulerVersion: version,
      productIds: ids, completedProductIds: ids.slice(0, finished), total: count, checked: finished, changed: 0, pendingReview: 0,
      failed: 0, skipped: finished, startedAt: null, completedAt: null, reason: null, errorMessage: null,
      scope: "ALL", trigger: "MANUAL", dismissedAt: null, createdAt: now, updatedAt: now, autoHoldQueued: 0 }],
    priceCheckJobItem: version === 2 ? ids.map((productId, position) => ({ id: `item-${position}`, jobId: "job-a", storeId: "store-a", productId, position,
      status: position < finished ? "COMPLETED" : "PENDING", nextAttemptAt: now, attempts: 0, remoteWriteStarted: false, leaseExpiresAt: null,
      checked: position < finished ? 1 : 0, failed: 0, skipped: 0, changed: 0, pendingReview: 0, completedAt: null, claimToken: null })) : [],
  };
  tables.variant = tables.product.flatMap(row => row.variants as Row[]);
  let idCounter = 0;
  const model = (name: string) => {
    const all = (query: Query = {}) => tables[name].filter(row => matches(name === "priceCheckJobItem"
      ? { ...row, job: tables.priceCheckJob.find(job => job.id === row.jobId) } : row, query.where)).sort((a,b) => {
      for (const order of [query.orderBy ?? {}].flat()) for (const [key, direction] of Object.entries(order)) {
        // PostgreSQL enum order is MANUAL, AUTOMATIC.
        const left = key === "trigger" ? (a[key] === "MANUAL" ? 0 : 1) : a[key];
        const right = key === "trigger" ? (b[key] === "MANUAL" ? 0 : 1) : b[key];
        const comparison = left! < right! ? -1 : left! > right! ? 1 : 0;
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
      return 0;
    });
    return {
      findUnique: async (query: Query) => all(query)[0] ?? null,
      findUniqueOrThrow: async (query: Query) => { const row = all(query)[0]; if (!row) throw new Error("Missing row"); return row; },
      findFirst: async (query: Query) => all(query)[0] ?? null,
      findMany: async (query: Query = {}) => all(query).slice(0, query.take),
      count: async (query: Query) => all(query).length,
      create: async (query: Query) => { const row = { id: `created-${++idCounter}`, acquiredAt: new Date(), renewedAt: new Date(), observedAt: new Date(),
        ...(name === "priceCheckJob" ? { completedProductIds: [], checked: 0, failed: 0, skipped: 0, changed: 0, pendingReview: 0, createdAt: new Date(), updatedAt: new Date(), dismissedAt: null } : {}), ...query.data }; tables[name].push(row); return row; },
      createMany: async (query: { data: Row[] }) => {
        for (const data of query.data) tables[name].push({ id: `created-${++idCounter}`, acquiredAt: new Date(), renewedAt: new Date(), ...data });
        return { count: query.data.length };
      },
      upsert: async (query: Query & { create: Row; update: Row }) => {
        let row = all(query)[0];
        if (!row) { row = { id: `created-${++idCounter}`, consecutivePostcodeFailures: 0, amazonBlockedUntil: null, amazonCooldownSeconds: 0, ...query.create }; tables[name].push(row); }
        else update(row, query.update);
        return row;
      },
      update: async (query: Query) => { const row = all(query)[0]; if (!row) throw new Error(`Missing ${name}`); update(row, query.data ?? {}); return row; },
      updateMany: async (query: Query) => { const rows = all(query); rows.forEach(row => update(row, query.data ?? {})); return { count: rows.length }; },
      delete: async (query: Query) => { const row = all(query)[0]; tables[name] = tables[name].filter(candidate => candidate !== row); return row; },
      deleteMany: async (query: Query) => { const rows = all(query); tables[name] = tables[name].filter(row => !rows.includes(row)); return { count: rows.length }; },
    };
  };
  let lock = Promise.resolve();
  const database = { ...Object.fromEntries(Object.keys(tables).map(name => [name, model(name)])),
    async $transaction<T>(operation: (tx: unknown) => Promise<T>) {
      const previous = lock;
      let release = () => {};
      lock = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const clone = (value: unknown): unknown => {
        if (value instanceof Date) return new Date(value.getTime());
        if (Prisma.Decimal.isDecimal(value)) return Number(value);
        if (Array.isArray(value)) return value.map(clone);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,clone(item)]));
        return value;
      };
      const before = clone(tables) as typeof tables;
      try { return await operation({ ...database, $queryRaw: async () => [] }); }
      catch (error) { Object.assign(tables, before); throw error; }
      finally { release(); }
    },
  };
  let ebay: (...args: unknown[]) => Promise<{ success: boolean; errorMessage?: string; outcomeUncertain?: boolean }> = async () => ({ success: true });
  let scrapeCalls = 0;
  let scrape: (signal?: AbortSignal, options?: Record<string,unknown>) => Promise<unknown>;
  let clock: (() => number) | undefined;
  class FixtureDate extends Date {
    static now() { return clock ? clock() : Date.now(); }
  }
  const fixtureModule = { exports: {} };
  vm.runInNewContext(await compiled, { module: fixtureModule, exports: fixtureModule.exports, require: createRequire(import.meta.url),
    globalThis: { database, Prisma, ebay: (...args: unknown[]) => ebay(...args), scrape: (...args: unknown[]) => {
      scrapeCalls++; return scrape((args[5] as { signal?: AbortSignal })?.signal, args[5] as Record<string,unknown>);
    } }, process, console, Buffer, URL, URLSearchParams, Date: FixtureDate, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => { throw new Error("Unexpected marketplace or network write"); },
  });
  const api = fixtureModule.exports as typeof Cooldown & { runPriceCheck: typeof runPriceCheck; runPriceCheckJob: typeof runPriceCheckJob; runNextPriceCheckJobForStore: typeof runNextPriceCheckJobForStore; createPriceCheckJob: typeof createPriceCheckJob;
    PriceCheckFailure: typeof PriceCheckFailure; AmazonDeliveryFailure: typeof AmazonDeliveryFailure; runNextPriceCheckItemForStore: typeof runNextPriceCheckItemForStore;
    cancelItemScheduledJob: typeof cancelItemScheduledJob };
  scrape = async () => { throw new api.AmazonDeliveryFailure("HTTP 503; popup recovery timed out", {
    technicalCode: "AMAZON_DELIVERY_HTTP_ERROR", stage: "popup-input", httpStatus: 503, requestedPostcode: "2217" }); };
  return { api, tables, database, setClock: (value: () => number) => { clock = value; }, setEbay: (value: typeof ebay) => { ebay = value; }, calls: () => scrapeCalls, setScrape: (value: typeof scrape) => { scrape = value; },
    expire: () => {
      tables.priceCheckScheduleState.forEach(row => { row.amazonBlockedUntil = new Date(0); });
      tables.priceCheckJobItem.filter(row => row.status === "RETRY_WAIT").forEach(row => { row.nextAttemptAt = new Date(0); });
    } };
}

test("cooldown survives execution restart, admits one probe, escalates 1/2/5/15 minutes, and isolates stores", async () => {
  const f = await fixture();
  let permit = await f.api.acquireDeliveryPermit("store-a", "job-a", 120000);
  for (const seconds of [60, 120, 300, 900, 900]) {
    const waiting = await f.api.deferAmazonDelivery(permit, "AMAZON_DELIVERY_HTTP_ERROR");
    await f.api.releaseDeliveryPermit(permit);
    assert.equal(f.tables.priceCheckScheduleState[0].amazonCooldownSeconds, seconds);
    assert.ok(waiting.retryAt);
    assert.ok((await f.api.acquireDeliveryPermit("store-a", "new-execution", 120000)).wait);
    assert.equal((await f.api.acquireDeliveryPermit("store-b", "job-b", 120000)).wait, undefined);
    f.expire();
    const [first, second] = await Promise.all([
      f.api.acquireDeliveryPermit("store-a", "worker-a", 120000), f.api.acquireDeliveryPermit("store-a", "worker-b", 120000),
    ]);
    assert.ok(first.token); assert.ok(second.wait); permit = first;
  }
  await f.api.confirmAmazonDelivery(permit);
  await f.api.releaseDeliveryPermit(permit);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  assert.equal(f.tables.jobLease.length, 0);
});

test("809 products stop on the first technical incident without product writes, checkpoints, holds, or eBay calls", async () => {
  const f = await fixture();
  const completed: string[] = [];
  const result = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true, onProductComplete: id => { completed.push(id); } });
  assert.equal(result.deferred, true); assert.equal(result.checked, 0); assert.equal(result.failed, 0);
  assert.equal(f.calls(), 1); assert.equal(completed.length, 0);
  assert.ok(f.tables.product.every(row => row.lastPriceCheck === null));
  assert.equal(f.tables.amazonPriceObservation.length, 1);
  assert.equal(f.tables.amazonPriceObservation[0].failureCode, "TECHNICAL_ERROR");
  assert.match(String(f.tables.amazonPriceObservation[0].message), /AMAZON_DELIVERY_HTTP_ERROR/);
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(f.calls(), 1, "direct checks must honor persisted cooldown");
});

test("version 1 queues unfinished work and keeps existing counters and checkpoints", async () => {
  const f = await fixture(809, 1, 2);
  await f.api.runPriceCheckJob("job-a");
  const job = f.tables.priceCheckJob[0];
  assert.equal(job.status, "QUEUED"); assert.equal(job.checked, 2); assert.equal(job.failed, 0);
  assert.equal(job.completedAt, null); assert.deepEqual(job.completedProductIds, ["product-0", "product-1"]);
  await f.api.runPriceCheckJob("job-a");
  assert.equal(f.calls(), 1); assert.equal(job.checked, 2);
});

test("version 2 leaves the incident product in retry wait; cancellation stops its recovery", async () => {
  const f = await fixture(809, 2);
  const worker = { workerId: "worker-a", workerName: "Worker A", workerRole: "legacy" as const };
  await f.api.runNextPriceCheckItemForStore("store-a", worker);
  const job = f.tables.priceCheckJob[0], item = f.tables.priceCheckJobItem[0];
  assert.equal(item.status, "RETRY_WAIT"); assert.equal(item.attempts, 0);
  assert.equal(item.claimToken, null); assert.equal(item.completedAt, null);
  assert.equal(job.checked, 0); assert.equal(job.failed, 0); assert.equal(job.completedAt, null);
  assert.equal(f.tables.jobLease.length, 0);
  await f.api.cancelItemScheduledJob("job-a", false);
  f.expire();
  assert.equal(await f.api.runNextPriceCheckItemForStore("store-a", worker), false);
  assert.equal(job.status, "CANCELLED"); assert.equal(f.calls(), 1);
});

test("a product-page HTTP 404 completes only that product without store cooldown or a hold", async () => {
  const f = await fixture(1);
  f.setScrape(async () => { throw new f.api.AmazonDeliveryFailure("Amazon product page returned HTTP 404", {
    technicalCode: "AMAZON_PRODUCT_PAGE_NOT_FOUND", stage: "product-navigation", httpStatus: 404,
    requestedPostcode: "2217", pageClassification: "UNRECOGNIZED",
  }); });
  await f.api.runPriceCheckJob("job-a");
  const job = f.tables.priceCheckJob[0];
  assert.equal(f.calls(), 2, "one fresh-context retry is allowed");
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.checked, 1);
  assert.equal(job.failed, 1);
  assert.deepEqual(job.completedProductIds, ["product-0"]);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  assert.equal(f.tables.product[0].lastPriceCheck, null, "technical attempts cannot advance observation freshness");
  assert.equal(f.tables.product[0].priceCheckFailureCode, "TECHNICAL_ERROR");
  assert.equal(f.tables.jobLease.length, 0);
});
test("verified product-specific unavailability recovers delivery before normal failure handling", async () => {
  const f = await fixture(1);
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true }); f.expire();
  f.setScrape(async () => ({ price: null, stockLeft: 0, postcodeVerified: true, detectedAsin: "B0G6CQ427S", identityOutcome: "MATCH", buyBoxOutcome: "UNAVAILABLE" }));
  const result = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(result.deferred, undefined); assert.equal(result.checked, 1); assert.equal(result.failed, 1);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  assert.ok(f.tables.product[0].lastPriceCheck);
});

test("ambiguous setup gets one fresh-context retry, then defers without a third attempt", async () => {
  const f = await fixture(1);
  f.setScrape(async () => { throw new f.api.AmazonDeliveryFailure("Popup timeout", {
    technicalCode: "AMAZON_DELIVERY_POPUP_TIMEOUT", stage: "popup-input", requestedPostcode: "2217" }); });
  const result = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(f.calls(), 2); assert.equal(result.deferred, true); assert.equal(result.failed, 0);
  assert.equal(f.tables.product[0].lastPriceCheck, null);
});

for (const version of [1, 2]) test(`version ${version} resumes the preserved product after verified recovery`, async () => {
  const f = await fixture(1, version);
  const worker = { workerId: "worker-a", workerName: "Worker A", workerRole: "legacy" as const };
  const run = () => version === 1 ? f.api.runPriceCheckJob("job-a") : f.api.runNextPriceCheckItemForStore("store-a", worker);
  await run(); f.expire();
  f.setScrape(async () => ({ price: null, stockLeft: 0, postcodeVerified: true, detectedAsin: "B0G6CQ427S", identityOutcome: "MATCH", buyBoxOutcome: "UNAVAILABLE" }));
  await run();
  assert.equal(f.tables.priceCheckJob[0].status, "COMPLETED");
  assert.equal(f.tables.priceCheckJob[0].checked, 1);
  assert.deepEqual(f.tables.priceCheckJob[0].completedProductIds, ["product-0"]);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  assert.equal(f.tables.jobLease.length, 0);
});

test("cancel during scraping aborts the operation without cooldown or completion", async () => {
  const f = await fixture(1);
  let cancelled = false;
  f.setScrape(signal => new Promise((_, reject) => { signal?.addEventListener("abort", () => reject(signal.reason), { once: true }); }));
  const timer = setTimeout(() => { cancelled = true; }, 50);
  try {
    const result = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true, shouldCancel: () => cancelled });
    assert.equal(result.cancelled, true); assert.equal(result.checked, 0); assert.equal(result.failed, 0);
    assert.equal(f.calls(), 1); assert.equal(f.tables.amazonPriceObservation.length, 0);
    assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  } finally { clearTimeout(timer); }
});

test("expired uncertain eBay writes remain terminal and are never replayed as setup retries", async () => {
  const f = await fixture(1, 2);
  Object.assign(f.tables.priceCheckJobItem[0], { status: "RUNNING", leaseExpiresAt: new Date(0), remoteWriteStarted: true });
  f.tables.priceCheckJob[0].status = "RUNNING";
  await f.api.runNextPriceCheckItemForStore("store-a", { workerId: "worker-a", workerName: "Worker A", workerRole: "legacy" });
  assert.equal(f.calls(), 0); assert.equal(f.tables.priceCheckJobItem[0].status, "FAILED");
  assert.match(String(f.tables.priceCheckJobItem[0].errorMessage), /uncertain/);
});

test("overlapping technical failures share one cooldown instead of multiplying the backoff", async () => {
  const f = await fixture(2);
  const [first, second] = await Promise.all([
    f.api.acquireDeliveryPermit("store-a", "job-a", 120000),
    f.api.acquireDeliveryPermit("store-a", "job-b", 120000),
  ]);
  const outcomes = await Promise.all([
    f.api.deferAmazonDelivery(first, "AMAZON_DELIVERY_HTTP_ERROR"),
    f.api.deferAmazonDelivery(second, "AMAZON_DELIVERY_POPUP_TIMEOUT"),
  ]);
  assert.equal(outcomes[0].retryAt, outcomes[1].retryAt);
  assert.equal(f.tables.priceCheckScheduleState[0].consecutivePostcodeFailures, 1);
  assert.equal(f.tables.priceCheckScheduleState[0].amazonCooldownSeconds, 60);
  assert.equal(f.calls(), 0);
});

test("an expired recovery owner cannot clear, extend, or release a newer worker's lease", async () => {
  const f = await fixture(1);
  const initial = await f.api.acquireDeliveryPermit("store-a", "job-a", 120000);
  await f.api.deferAmazonDelivery(initial, "AMAZON_DELIVERY_HTTP_ERROR");
  f.expire();
  const oldProbe = await f.api.acquireDeliveryPermit("store-a", "worker-old", 120000);
  assert.ok(oldProbe.token);
  f.tables.jobLease[0].expiresAt = new Date(0);
  const newProbe = await f.api.acquireDeliveryPermit("store-a", "worker-new", 120000);
  assert.ok(newProbe.token);
  assert.notEqual(oldProbe.token, newProbe.token);
  await f.api.deferAmazonDelivery(newProbe, "AMAZON_DELIVERY_HTTP_ERROR");
  const before = structuredClone(f.tables.priceCheckScheduleState[0]);

  await assert.rejects(f.api.confirmAmazonDelivery(oldProbe), /ownership expired/);
  await assert.rejects(f.api.deferAmazonDelivery(oldProbe, "AMAZON_DELIVERY_POPUP_TIMEOUT"), /ownership expired/);
  await f.api.releaseDeliveryPermit(oldProbe);
  assert.deepEqual(f.tables.priceCheckScheduleState[0], before);
  assert.equal(f.tables.jobLease[0].workerId, newProbe.token);
  assert.equal(f.tables.priceCheckScheduleState[0].consecutivePostcodeFailures, 2);

  await f.api.confirmAmazonDelivery(newProbe);
  await f.api.releaseDeliveryPermit(newProbe);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
  assert.equal(f.tables.jobLease.length, 0);
});

const workerA = { workerId: "worker-a", workerName: "Worker A", workerRole: "store-specific" as const };
const workerB = { workerId: "worker-b", workerName: "Worker B", workerRole: "store-specific" as const };
function promiseGate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function verified(price: number, observedAt: Date, stockLeft = 10) {
  return { price, observedAt, stockLeft, postcodeVerified: true, detectedAsin: "B0G6CQ427S",
    identityOutcome: "MATCH", buyBoxOutcome: "AVAILABLE", acceptedPriceSource: "#buybox" };
}
function addJob(f: Awaited<ReturnType<typeof fixture>>, id: string, trigger: "MANUAL" | "AUTOMATIC") {
  const job = { ...f.tables.priceCheckJob[0], id, trigger, status: "QUEUED", checked: 0,
    completedProductIds: [], startedAt: null, createdAt: new Date(), updatedAt: new Date() };
  f.tables.priceCheckJob.push(job);
  return job;
}

for (const newestFirst of [true, false]) {
  test(`overlapping jobs apply observation time when the first job obtains its result ${newestFirst ? "last" : "first"}`, async () => {
    const f = await fixture(1);
    f.tables.priceCheckJob[0].trigger = "AUTOMATIC";
    addJob(f, "manual-job", "MANUAL");
    const entered = promiseGate<void>();
    const firstResponse = promiseGate<unknown>();
    let calls = 0;
    const earlier = new Date(Date.now() + 1000);
    const later = new Date(earlier.getTime() + 1000);
    f.setScrape(async () => { if (++calls === 1) { entered.resolve(); return firstResponse.promise; }
      return verified(90, newestFirst ? earlier : later); });
    const running = f.api.runPriceCheckJob("job-a", workerA);
    await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(JSON.stringify(f.tables.priceCheckJob))), 3000))]);
    const duplicate = f.api.runPriceCheckJob("job-a", workerB);
    await assert.rejects(duplicate, /claimed|overlapping/i);
    await f.api.runPriceCheckJob("manual-job", workerB);
    assert.equal(f.tables.priceCheckJob[1].status, "COMPLETED", "manual finishes while automatic still scraping");
    assert.equal(f.tables.priceCheckJob[0].status, "RUNNING");
    firstResponse.resolve(verified(80, newestFirst ? later : earlier));
    await running;
    assert.equal(Number(f.tables.product[0].amazonPrice), newestFirst ? 80 : 90);
    assert.equal((f.tables.product[0].lastPriceCheck as Date).getTime(), later.getTime());
    assert.equal(f.tables.amazonPriceObservation.length, 2, "both snapshots remain diagnostic evidence");
    assert.equal(f.tables.priceCheckJob[0].changed, newestFirst ? 1 : 0);
    assert.equal(f.tables.jobLease.length, 0);
    assert.ok(f.tables.priceCheckJob.every(job => (job.completedProductIds as string[]).length === 1));
  });
}

test("manual selection is not hidden behind more than ten older automatic jobs", async () => {
  const f = await fixture(1);
  f.tables.priceCheckJob[0].trigger = "AUTOMATIC";
  for (let i=0;i<15;i++) addJob(f, `auto-${i}`, "AUTOMATIC");
  const manual = addJob(f, "manual-last", "MANUAL");
  f.setScrape(async () => verified(100, new Date()));
  await f.api.runNextPriceCheckJobForStore("store-a", workerA);
  assert.equal(manual.status, "COMPLETED");
  assert.ok(f.tables.priceCheckJob.filter(job => job.trigger === "AUTOMATIC").every(job => job.status === "QUEUED"));
});

test("equal observation times retain the already accepted snapshot", async () => {
  const f = await fixture(1);
  const observedAt = new Date();
  f.setScrape(async () => verified(90, observedAt));
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  f.setScrape(async () => verified(80, observedAt));
  const second = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(second.changed, 0);
  assert.equal(Number(f.tables.product[0].amazonPrice), 90);
});

test("new verified unavailability wins and an older available snapshot cannot restore stock", async () => {
  const f = await fixture(1);
  const earlier = new Date(Date.now()-1000), later = new Date();
  f.setScrape(async () => ({ ...verified(100,later), price: null, stockLeft: 0, buyBoxOutcome: "UNAVAILABLE" }));
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  f.setScrape(async () => verified(100, earlier));
  const stale = await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(stale.failed, 0);
  assert.equal(f.tables.product[0].amazonAvailability, "OUT_OF_STOCK");
  assert.equal(f.tables.product[0].amazonStockLeft, 0);
  assert.equal(f.tables.product[0].priceCheckFailureCode, "AMAZON_BUYBOX_UNAVAILABLE");
});

test("new verified availability replaces an unavailable observation and its stale reviews", async () => {
  const f = await fixture(1);
  const earlier = new Date(Date.now()-1000), later = new Date();
  f.setScrape(async () => ({ ...verified(100,earlier), price: null, stockLeft: 0, buyBoxOutcome: "UNAVAILABLE" }));
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  f.tables.priceHistory.push({ productId: "product-0", createdAt: earlier, appliedAt: null });
  f.setScrape(async () => verified(100,later));
  await f.api.runPriceCheck({ storeId: "store-a", ignoreSchedule: true });
  assert.equal(f.tables.product[0].amazonAvailability, "IN_STOCK");
  assert.equal(f.tables.product[0].priceCheckFailureCode, null);
  assert.equal(f.tables.priceHistory[0].status, "SUPERSEDED");
});

test("concurrent automatic enqueue requests reuse the same active automatic job", async () => {
  const f = await fixture(1);
  const requests = Array.from({length: 4}, () => f.api.createPriceCheckJob({
    storeId: "store-a", userId: "user-a", all: true, trigger: "AUTOMATIC",
  }));
  const results = await Promise.all(requests);
  assert.equal(new Set(results.map(result => result.job.id)).size, 1);
  assert.equal(f.tables.priceCheckJob.filter(job => job.trigger === "AUTOMATIC").length, 1);
  assert.equal(f.tables.priceCheckJob.filter(job => job.trigger === "MANUAL").length, 1);
});

for (const storeId of ["seed-store-1", "cmryiv1u1000wmsumt3z8qla5", "seed-store-2"]) {
  test(`both workers can run overlapping checks with isolated delivery sessions for ${storeId}`, async () => {
    const f = await fixture(1);
    for (const rows of Object.values(f.tables)) for (const row of rows) if (row.storeId === "store-a") row.storeId = storeId;
    f.tables.store[0].id = storeId;
    addJob(f,"job-b","MANUAL");
    const oldFeatures = process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS;
    const oldMode = process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE;
    process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = "delivery-state";
    process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = "all";
    const sessions: unknown[] = [];
    const both = promiseGate<void>();
    let calls = 0;
    f.setScrape(async (_,options) => {
      sessions.push(options?.deliveryState);
      if (++calls === 2) both.resolve();
      await both.promise;
      return verified(100,new Date());
    });
    try {
      await Promise.all([f.api.runPriceCheckJob("job-a",workerA), f.api.runPriceCheckJob("job-b",workerB)]);
      assert.equal(sessions.length,2);
      assert.ok(sessions[0] && sessions[1] && sessions[0] !== sessions[1]);
      assert.ok(f.tables.priceCheckJob.every(job => job.status === "COMPLETED"));
      assert.equal(f.tables.jobLease.length,0);
    } finally {
      if (oldFeatures === undefined) delete process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS; else process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = oldFeatures;
      if (oldMode === undefined) delete process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE; else process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = oldMode;
    }
  });
}

test("a delayed older eBay write settles before the newest observation is applied", async () => {
  const f = await fixture(1);
  addJob(f,"job-b","MANUAL");
  const firstWrite = promiseGate<void>();
  const releaseWrite = promiseGate<void>();
  const xmlWrites: string[] = [];
  f.setEbay(async xml => {
    xmlWrites.push(String(xml));
    if (xmlWrites.length === 1) { firstWrite.resolve(); await releaseWrite.promise; }
    return { success: true };
  });
  let calls = 0;
  const firstAt = new Date(Date.now()+1000), secondAt = new Date(firstAt.getTime()+1000);
  f.setScrape(async () => verified(++calls === 1 ? 110 : 120, calls === 1 ? firstAt : secondAt));
  const first = f.api.runPriceCheckJob("job-a",workerA);
  await firstWrite.promise;
  const second = f.api.runPriceCheckJob("job-b",workerB);
  while (f.tables.amazonPriceObservation.length < 2) await new Promise(resolve => setTimeout(resolve,10));
  assert.equal(xmlWrites.length,1, "newer request waits for the older request to settle");
  releaseWrite.resolve();
  await Promise.all([first,second]);
  assert.equal(xmlWrites.length,2);
  assert.equal(Number(f.tables.product[0].amazonPrice),120);
  assert.equal((f.tables.product[0].lastPriceCheck as Date).getTime(),secondAt.getTime());
  assert.ok(f.tables.listingOperation.every(row => row.stage === "COMPLETED"));
  assert.equal(f.tables.jobLease.length,0);
});

test("an ambiguous eBay response blocks automatic replay while fresh Amazon observations continue", async () => {
  const f = await fixture(1);
  let writes = 0;
  f.setEbay(async () => { writes++; return {success:false,errorMessage:"Request timed out",outcomeUncertain:true}; });
  const firstAt = new Date();
  f.setScrape(async () => verified(110,firstAt));
  await f.api.runPriceCheck({storeId:"store-a",ignoreSchedule:true});
  assert.equal(f.tables.listingOperation[0].stage,"RECONCILIATION");
  f.setScrape(async () => verified(120,new Date(firstAt.getTime()+1000)));
  await f.api.runPriceCheck({storeId:"store-a",ignoreSchedule:true});
  assert.equal(writes,1);
  assert.equal(Number(f.tables.product[0].amazonPrice),120);
});

test("another job's lastPriceCheck is never inferred as this job's completion", async () => {
  const f = await fixture(1);
  f.tables.priceCheckJob[0].startedAt = new Date(Date.now()-1000);
  f.tables.product[0].lastPriceCheck = new Date();
  f.setScrape(async () => verified(100,new Date(Date.now()+1000)));
  await f.api.runPriceCheckJob("job-a",workerA);
  assert.equal(f.calls(),1);
  assert.deepEqual(f.tables.priceCheckJob[0].completedProductIds,["product-0"]);
});


test("a busy marketplace lane defers without a failed product or Amazon cooldown", async () => {
  const f = await fixture(1);
  f.tables.jobLease.push({ storeId: "store-a", resourceKey: "ebay-api-write", jobType: "EBAY_ACTION",
    jobId: "bulk-edit", workerId: "other-worker", workerName: "Bulk worker",
    acquiredAt: new Date(), renewedAt: new Date(), expiresAt: new Date("2099-01-01") });
  f.setScrape(async () => {
    let now = Date.now();
    f.setClock(() => now += 120_001);
    return verified(100, new Date());
  });
  await f.api.runPriceCheckJob("job-a", workerA);
  const job = f.tables.priceCheckJob[0];
  assert.equal(job.status, "QUEUED");
  assert.equal(job.checked, 0);
  assert.equal(job.failed, 0);
  assert.deepEqual(job.completedProductIds, []);
  assert.match(String(job.reason), /marketplace update/);
  assert.equal(job.errorMessage, null);
  assert.equal(f.tables.product[0].lastPriceCheck, null);
  assert.equal(await f.api.getAmazonDeliveryWait("store-a"), null);
});

test("losing job ownership prevents product changes and checkpoint writes", async () => {
  const f = await fixture(1);
  const entered = promiseGate<void>(), release = promiseGate<void>();
  f.setScrape(async () => { entered.resolve(); await release.promise; return verified(90, new Date()); });
  const running = f.api.runPriceCheckJob("job-a", workerA);
  await entered.promise;
  f.tables.jobLease.length = 0;
  release.resolve();
  await running;
  assert.equal(Number(f.tables.product[0].amazonPrice), 100);
  assert.deepEqual(f.tables.priceCheckJob[0].completedProductIds, []);
  assert.equal(f.tables.priceCheckJob[0].checked, 0);
});

test("a manual job waits for either busy worker to finish without interrupting them", async () => {
  const f = await fixture(1);
  f.tables.priceCheckJob[0].trigger = "AUTOMATIC";
  addJob(f, "job-b", "AUTOMATIC");
  const entered = promiseGate<void>(), release = promiseGate<void>();
  let calls = 0;
  f.setScrape(async () => {
    if (++calls === 2) entered.resolve();
    await release.promise;
    return verified(100, new Date());
  });
  const busy = [f.api.runPriceCheckJob("job-a", workerA), f.api.runPriceCheckJob("job-b", workerB)];
  await entered.promise;
  const manual = addJob(f, "manual-waiting", "MANUAL");
  assert.equal(manual.status, "QUEUED");
  assert.equal(f.tables.priceCheckJob.filter(job => job.status === "RUNNING").length, 2);
  release.resolve();
  await Promise.all(busy);
  await f.api.runNextPriceCheckJobForStore("store-a", workerA);
  assert.equal(f.tables.priceCheckJob.find(job => job.id === manual.id)?.status, "COMPLETED");
  assert.equal(calls, 3);
});


test("a wrong-ASIN response retains the accepted price, stock, and freshness timestamp", async () => {
  const f = await fixture(1);
  const observedAt = new Date(Date.now()-1000);
  f.setScrape(async () => verified(100, observedAt));
  await f.api.runPriceCheck({storeId: "store-a", ignoreSchedule: true});
  f.setScrape(async () => ({...verified(1, new Date()), stockLeft: 0,
    detectedAsin: "B0OTHERASIN", identityOutcome: "MISMATCH"}));
  await f.api.runPriceCheck({storeId: "store-a", ignoreSchedule: true});
  assert.equal(Number(f.tables.product[0].amazonPrice), 100);
  assert.equal(f.tables.product[0].amazonStockLeft, 10);
  assert.equal(f.tables.product[0].amazonAvailability, "IN_STOCK");
  assert.equal((f.tables.product[0].lastPriceCheck as Date).getTime(), observedAt.getTime());
  assert.equal(f.tables.amazonPriceObservation.filter(row => row.isSuccessful).length, 1);
});


test("a failed observation insert defers rather than applying an unrecorded snapshot", async () => {
  const f = await fixture(1);
  const observations = (f.database as unknown as {amazonPriceObservation: {create: () => Promise<never>}}).amazonPriceObservation;
  observations.create = async () => { throw new Error("Database temporarily unavailable"); };
  f.setScrape(async () => verified(90, new Date()));
  await f.api.runPriceCheckJob("job-a", workerA);
  assert.equal(f.tables.priceCheckJob[0].status, "QUEUED");
  assert.equal(f.tables.priceCheckJob[0].checked, 0);
  assert.equal(f.tables.priceCheckJob[0].failed, 0);
  assert.equal(Number(f.tables.product[0].amazonPrice), 100);
  assert.deepEqual(f.tables.priceCheckJob[0].completedProductIds, []);
});
