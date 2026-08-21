import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveWorkerEnabled,
  resolveWorkerRole,
  rotateForRoundRobin,
  shouldDeferQueuedJob,
} from "./worker-routing";

test("Railway workers require an explicit enabled state", () => {
  assert.throws(
    () => resolveWorkerEnabled({ value: undefined, isRailway: true }),
    /must be explicitly set/,
  );
  assert.equal(
    resolveWorkerEnabled({ value: "true", isRailway: true }),
    true,
  );
  assert.equal(
    resolveWorkerEnabled({ value: "false", isRailway: true }),
    false,
  );
  assert.equal(
    resolveWorkerEnabled({ value: undefined, isRailway: false }),
    true,
  );
});

test("worker roles enforce unified and store-specific coverage", () => {
  assert.equal(resolveWorkerRole("unified", []), "unified");
  assert.equal(
    resolveWorkerRole("store-specific", ["oz-metro"]),
    "store-specific",
  );
  assert.throws(
    () => resolveWorkerRole("unified", ["oz-metro"]),
    /must not set/,
  );
  assert.throws(
    () => resolveWorkerRole("store-specific", []),
    /exactly one/,
  );
  assert.throws(
    () => resolveWorkerRole(undefined, [], { requireExplicit: true }),
    /explicitly set/,
  );
});

test("specialists get a three-second fresh-job priority window", () => {
  const now = new Date("2026-08-21T12:00:03.000Z");
  assert.equal(
    shouldDeferQueuedJob({
      workerRole: "unified",
      specialistOnline: true,
      createdAt: new Date("2026-08-21T12:00:01.000Z"),
      now,
      graceMs: 3_000,
    }),
    true,
  );
  assert.equal(
    shouldDeferQueuedJob({
      workerRole: "unified",
      specialistOnline: true,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
      now,
      graceMs: 3_000,
    }),
    false,
  );
  assert.equal(
    shouldDeferQueuedJob({
      workerRole: "unified",
      specialistOnline: false,
      createdAt: new Date("2026-08-21T12:00:02.900Z"),
      now,
      graceMs: 3_000,
    }),
    false,
  );
  assert.equal(
    shouldDeferQueuedJob({
      workerRole: "store-specific",
      specialistOnline: true,
      createdAt: new Date("2026-08-21T12:00:02.900Z"),
      now,
      graceMs: 3_000,
    }),
    false,
  );
});

test("unified store ordering rotates fairly", () => {
  const stores = ["aussie", "oz", "rk"];
  assert.deepEqual(rotateForRoundRobin(stores, 0), stores);
  assert.deepEqual(rotateForRoundRobin(stores, 1), ["oz", "rk", "aussie"]);
  assert.deepEqual(rotateForRoundRobin(stores, 2), ["rk", "aussie", "oz"]);
  assert.deepEqual(rotateForRoundRobin(stores, 3), stores);
});

test("all durable queues apply worker claim policy", () => {
  for (const path of [
    "lib/price-check-jobs.ts",
    "lib/ebay-action-jobs.ts",
    "lib/ebay-import-jobs.ts",
    "lib/ebay-research.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /filterRunnableJobsForWorker/, path);
    assert.match(source, /getWorkerClaimPolicy/, path);
  }
});

test("research recovery is lease-aware and claims queued work atomically", () => {
  const source = readFileSync("lib/ebay-research.ts", "utf8");
  const claimedJobSource = source.slice(
    source.indexOf("async function runEbayResearchJobClaimed"),
    source.indexOf("async function runEbayResearchJob(", source.indexOf("async function runEbayResearchJobClaimed")),
  );
  assert.match(source, /jobType: "EBAY_RESEARCH"/);
  assert.match(source, /leasedJobIds\.has\(job\.id\)/);
  assert.match(claimedJobSource, /status: EbayResearchJobStatus\.QUEUED/);
  assert.match(
    claimedJobSource,
    /const started = await prisma\.ebayResearchJob\.updateMany/,
  );
  assert.doesNotMatch(
    source.slice(
      source.indexOf("async function runEbayResearchQueue("),
      source.indexOf("export async function runEbayResearchQueueForStore"),
    ),
    /while \(true\)/,
  );
});

test("stock scheduling uses an atomic durable claim", () => {
  const source = readFileSync("lib/worker-schedule.ts", "utf8");
  assert.match(source, /workerSchedule\.updateMany/);
  assert.match(source, /claimExpiresAt: \{ lte: now \}/);
  assert.match(source, /claimExpiresAt: \{ gt: now \}/);
  assert.match(source, /withWorkerScheduleClaim/);
  assert.match(source, /claimed\.count !== 1/);

  const migration = readFileSync(
    "prisma/migrations/20260821150000_add_dual_worker_scheduling/migration.sql",
    "utf8",
  );
  assert.match(migration, /UNIQUE INDEX "WorkerSchedule_storeId_taskKey_key"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE "WorkerSchedule" FROM anon/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE "WorkerSchedule" FROM authenticated/,
  );
});
