import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Prisma } from "@/app/generated/prisma/client";
import type * as Cooldown from "./amazon-delivery-cooldown";
import type { runPriceCheck } from "./price-checker";
import type { runPriceCheckJob } from "./price-check-jobs";
import type { runNextPriceCheckItemForStore, cancelItemScheduledJob } from "./price-check-item-scheduler";
import type { AmazonDeliveryFailure } from "./amazon-delivery-recovery";

type Row = Record<string, unknown>;
type Query = { where?: Row; data?: Row; orderBy?: Row; take?: number };
const compiled = build({ stdin: { resolveDir: process.cwd(), contents: `
  export * from "./lib/amazon-delivery-cooldown";
  export { AmazonDeliveryFailure } from "./lib/amazon-delivery-recovery";
  export { runPriceCheck } from "./lib/price-checker";
  export { runPriceCheckJob } from "./lib/price-check-jobs";
  export { runNextPriceCheckItemForStore, cancelItemScheduledJob } from "./lib/price-check-item-scheduler";
` }, bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  plugins: [{ name: "isolated-database", setup(builder) {
    builder.onResolve({ filter: /^(server-only|(?:@\/lib\/|\.\/)(?:prisma|cache-tags|logger|amazon-scraper|scraper-browser|price-check-auto-hold)|@\/app\/generated\/prisma\/client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
      args.path === "server-only" ? "" : args.path.endsWith("/prisma") ? "export const prisma = globalThis.database;"
      : args.path.endsWith("/client") ? "export const Prisma = globalThis.Prisma;"
      : args.path.endsWith("cache-tags") ? "export const invalidatePriceCaches = () => {}; export const invalidateJobCaches = () => {};"
      : args.path.endsWith("logger") ? "export const logger = { info(){}, warn(){}, error(){}, debug(){} };"
      : args.path.endsWith("amazon-scraper") ? "export const scrapeAmazonPrice = (...args) => globalThis.scrape(...args);"
      : args.path.endsWith("scraper-browser") ? "export const launchScraperBrowser = async () => ({isConnected:()=>true,close:async()=>{}}); export const getBrowserLaunchUserMessage = () => null;"
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
      if ("in" in comparison) return (comparison.in as unknown[]).includes(actual);
      if ("gt" in comparison) return actual != null && Number(actual) > Number(comparison.gt);
      if ("gte" in comparison) return actual != null && Number(actual) >= Number(comparison.gte);
      if ("lte" in comparison) return actual != null && Number(actual) <= Number(comparison.lte);
      if ("lt" in comparison) return actual != null && Number(actual) < Number(comparison.lt);
      if ("startsWith" in comparison) return String(actual).startsWith(String(comparison.startsWith));
      if ("has" in comparison) return (actual as unknown[]).includes(comparison.has);
      return !!actual && typeof actual === "object" && matches(actual as Row, comparison);
    }
    return actual === condition;
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
    priceCheckScheduleState: [], jobLease: [], amazonPriceObservation: [],
    store: [{ id: "store-a", priceCheckItemSchedulerEnabled: version === 2 }],
    supplierSettings: [{ storeId: "store-a", supplierName: "Amazon AU", scrapePostcode: "2217", minProductQuantity: 1, priceTrackingEnabled: true }],
    product: ids.map(id => ({ id, storeId: "store-a", asin: "B0G6CQ427S", status: "IMPORTED", amazonPriceTrackingMode: "REGULAR",
      variants: [{ id: `${id}-variant`, buyPrice: 100, sellPrice: 120 }], store: {}, lastPriceCheck: null, itemSpecifics: {} })),
    priceCheckJob: [{ id: "job-a", storeId: "store-a", userId: "user-a", status: "QUEUED", schedulerVersion: version,
      productIds: ids, completedProductIds: ids.slice(0, finished), total: count, checked: finished, changed: 0, pendingReview: 0,
      failed: 0, skipped: finished, startedAt: null, completedAt: null, reason: null, errorMessage: null,
      scope: "ALL", trigger: "MANUAL", dismissedAt: null, createdAt: now, updatedAt: now, autoHoldQueued: 0 }],
    priceCheckJobItem: version === 2 ? ids.map((productId, position) => ({ id: `item-${position}`, jobId: "job-a", storeId: "store-a", productId, position,
      status: position < finished ? "COMPLETED" : "PENDING", nextAttemptAt: now, attempts: 0, remoteWriteStarted: false, leaseExpiresAt: null,
      checked: position < finished ? 1 : 0, failed: 0, skipped: 0, changed: 0, pendingReview: 0, completedAt: null, claimToken: null })) : [],
  };
  let idCounter = 0;
  const model = (name: string) => {
    const all = (query: Query = {}) => tables[name].filter(row => matches(name === "priceCheckJobItem"
      ? { ...row, job: tables.priceCheckJob.find(job => job.id === row.jobId) } : row, query.where));
    return {
      findUnique: async (query: Query) => all(query)[0] ?? null,
      findUniqueOrThrow: async (query: Query) => { const row = all(query)[0]; if (!row) throw new Error("Missing row"); return row; },
      findFirst: async (query: Query) => all(query)[0] ?? null,
      findMany: async (query: Query = {}) => all(query).slice(0, query.take),
      count: async (query: Query) => all(query).length,
      create: async (query: Query) => { const row = { id: `created-${++idCounter}`, observedAt: new Date(), ...query.data }; tables[name].push(row); return row; },
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
      const before = structuredClone(tables);
      try { return await operation({ ...database, $queryRaw: async () => [] }); }
      catch (error) { Object.assign(tables, before); throw error; }
      finally { release(); }
    },
  };
  let scrapeCalls = 0;
  let scrape: (signal?: AbortSignal) => Promise<unknown>;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(await compiled, { module: fixtureModule, exports: fixtureModule.exports, require: createRequire(import.meta.url),
    globalThis: { database, Prisma, scrape: (...args: unknown[]) => {
      scrapeCalls++; return scrape((args[5] as { signal?: AbortSignal })?.signal);
    } }, process, console, Buffer, URL, URLSearchParams, Date, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => { throw new Error("Unexpected marketplace or network write"); },
  });
  const api = fixtureModule.exports as typeof Cooldown & { runPriceCheck: typeof runPriceCheck; runPriceCheckJob: typeof runPriceCheckJob;
    AmazonDeliveryFailure: typeof AmazonDeliveryFailure; runNextPriceCheckItemForStore: typeof runNextPriceCheckItemForStore;
    cancelItemScheduledJob: typeof cancelItemScheduledJob };
  scrape = async () => { throw new api.AmazonDeliveryFailure("HTTP 503; popup recovery timed out", {
    technicalCode: "AMAZON_DELIVERY_HTTP_ERROR", stage: "popup-input", httpStatus: 503, requestedPostcode: "2217" }); };
  return { api, tables, calls: () => scrapeCalls, setScrape: (value: typeof scrape) => { scrape = value; },
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
  assert.ok(f.tables.product[0].lastPriceCheck);
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
