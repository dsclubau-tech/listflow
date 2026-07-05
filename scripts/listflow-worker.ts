import "dotenv/config";

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

const moduleWithLoad = Module as unknown as {
  _load: (
    request: string,
    parent?: unknown,
    isMain?: boolean
  ) => unknown;
};
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

const IDLE_SLEEP_MS = parsePositiveMs(
  process.env.LISTFLOW_WORKER_IDLE_SLEEP_MS,
  10_000
);
const ERROR_SLEEP_MS = parsePositiveMs(
  process.env.LISTFLOW_WORKER_ERROR_SLEEP_MS,
  Math.max(IDLE_SLEEP_MS, 30_000)
);
const STOCK_REPLENISH_ENABLED =
  process.env.LISTFLOW_STOCK_REPLENISH_ENABLED !== "false";
const STOCK_REPLENISH_INTERVAL_MS = parsePositiveMs(
  process.env.LISTFLOW_STOCK_REPLENISH_INTERVAL_MS,
  10 * 60 * 1000
);
const workerName = process.env.LISTFLOW_WORKER_NAME || `${os.hostname()} manual worker`;
const workerId =
  process.env.LISTFLOW_WORKER_ID ||
  `manual-${os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
const startedAt = new Date();
let stopping = false;
let heartbeatStoreIds: string[] = [];
let localGuardPath: string | null = null;
const loggedOnlineStoreIds = new Set<string>();
const nextStockReplenishAtByStoreId = new Map<string, number>();

async function loadWorkerModules() {
  const [
    prismaModule,
    ebayImportJobs,
    ebayActionJobs,
    ebayResearch,
    priceCheckJobs,
    stockReplenishment,
    workerHeartbeat,
    loggerModule,
  ] = await Promise.all([
    import("../lib/prisma"),
    import("../lib/ebay-import-jobs"),
    import("../lib/ebay-action-jobs"),
    import("../lib/ebay-research"),
    import("../lib/price-check-jobs"),
    import("../lib/stock-replenishment"),
    import("../lib/worker-heartbeat"),
    import("../lib/logger"),
  ]);

  return {
    prisma: prismaModule.prisma,
    runNextEbayImportJobForStore: ebayImportJobs.runNextEbayImportJobForStore,
    runNextEbayActionJobForStore: ebayActionJobs.runNextEbayActionJobForStore,
    runEbayResearchQueueForStore: ebayResearch.runEbayResearchQueueForStore,
    runNextPriceCheckJobForStore: priceCheckJobs.runNextPriceCheckJobForStore,
    runStockReplenishmentForStore: stockReplenishment.runStockReplenishmentForStore,
    touchWorkerHeartbeat: workerHeartbeat.touchWorkerHeartbeat,
    heartbeatIntervalMs: workerHeartbeat.WORKER_HEARTBEAT_INTERVAL_MS,
    logger: loggerModule.logger.child({
      source: "worker",
      runtime: "worker",
      workerId,
      workerName,
      tags: ["worker"],
    }),
  };
}

function getWorkerContext() {
  return { workerId, workerName };
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLocalWorkerGuard() {
  const logsDir = path.join(process.cwd(), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const lockPath = path.join(logsDir, `${workerId}.worker.lock`);

  if (fs.existsSync(lockPath)) {
    const existingPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);

    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      throw new Error(
        `Another ListFlow Worker window is already running for ${workerId}. Close it before starting a second one.`
      );
    }

    fs.rmSync(lockPath, { force: true });
  }

  fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  localGuardPath = lockPath;
}

function releaseLocalWorkerGuard() {
  if (localGuardPath) {
    fs.rmSync(localGuardPath, { force: true });
    localGuardPath = null;
  }
}

let modules: Awaited<ReturnType<typeof loadWorkerModules>>;

function parsePositiveMs(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function parseStoreFilter() {
  const raw = process.env.LISTFLOW_WORKER_STORE_LOGIN_ID?.trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function getActiveStores() {
  const storeFilters = parseStoreFilter();

  return modules.prisma.store.findMany({
    where: {
      isActive: true,
      ...(storeFilters.length > 0
        ? {
            OR: [
              { id: { in: storeFilters } },
              { loginId: { in: storeFilters } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      loginId: true,
    },
  });
}

async function heartbeat(storeIds = heartbeatStoreIds) {
  await Promise.all(
    storeIds.map((storeId) =>
      modules.touchWorkerHeartbeat({
        storeId,
        workerId,
        workerName,
        startedAt,
        version: process.env.npm_package_version ?? null,
      })
    )
  );
}

async function processStore(store: { id: string; name: string; loginId: string | null }) {
  const worker = getWorkerContext();

  if (await modules.runNextPriceCheckJobForStore(store.id, worker)) {
    return true;
  }

  if (await modules.runNextEbayActionJobForStore(store.id, worker)) {
    return true;
  }

  if (await modules.runNextEbayImportJobForStore(store.id, worker)) {
    return true;
  }

  await modules.runEbayResearchQueueForStore(store.id, worker);

  if (!STOCK_REPLENISH_ENABLED) {
    return false;
  }

  const now = Date.now();
  const nextRunAt = nextStockReplenishAtByStoreId.get(store.id) ?? 0;

  if (now < nextRunAt) {
    return false;
  }

  nextStockReplenishAtByStoreId.set(
    store.id,
    now + STOCK_REPLENISH_INTERVAL_MS
  );
  const result = await modules.runStockReplenishmentForStore(store.id, worker);

  return result.replenished > 0 || result.failed > 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add it to .env before starting the worker.");
  }

  modules = await loadWorkerModules();
  acquireLocalWorkerGuard();

  console.log("ListFlow Worker online");
  console.log(`Worker: ${workerName}`);
  console.log("Waiting for jobs...");
  if (STOCK_REPLENISH_ENABLED) {
    console.log(
      `Stock replenish: every ${Math.round(STOCK_REPLENISH_INTERVAL_MS / 60_000)} min`
    );
  }
  modules.logger.info("worker/start", "ListFlow Worker online", {
    workerId,
    workerName,
    storeFilter: parseStoreFilter(),
    stockReplenishEnabled: STOCK_REPLENISH_ENABLED,
    stockReplenishIntervalMs: STOCK_REPLENISH_INTERVAL_MS,
  });

  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      console.error(
        "Worker heartbeat failed:",
        error instanceof Error ? error.message : error
      );
      modules.logger.warn("worker/heartbeat", "Worker heartbeat failed", {
        error: error instanceof Error ? error.message : error,
      });
    });
  }, modules.heartbeatIntervalMs);

  try {
    while (!stopping) {
      try {
        const stores = await getActiveStores();
        heartbeatStoreIds = stores.map((store) => store.id);

        for (const store of stores) {
          if (!loggedOnlineStoreIds.has(store.id)) {
            loggedOnlineStoreIds.add(store.id);
            modules.logger.info(
              "worker/store-online",
              "Worker available for store",
              {
                workerId,
                workerName,
                storeName: store.name,
                storeLoginId: store.loginId,
              },
              { storeId: store.id },
            );
          }
        }

        if (stores.length === 0) {
          console.log("No active stores found. Waiting...");
          await sleep(IDLE_SLEEP_MS);
          continue;
        }

        await heartbeat();

        let didWork = false;

        for (const store of stores) {
          if (stopping) {
            break;
          }

          didWork = (await processStore(store)) || didWork;
        }

        if (!didWork && !stopping) {
          await sleep(IDLE_SLEEP_MS);
        }
      } catch (error) {
        if (stopping) {
          break;
        }

        const message = getErrorMessage(error);
        console.error(`Worker loop failed; retrying in ${ERROR_SLEEP_MS}ms:`, message);
        modules.logger.warn("worker/loop", "Worker loop failed; retrying", {
          error: message,
          retryInMs: ERROR_SLEEP_MS,
        });
        await sleep(ERROR_SLEEP_MS);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    modules.logger.info("worker/stop", "ListFlow Worker stopped", {
      workerId,
      workerName,
    });
    await modules.prisma.$disconnect();
    releaseLocalWorkerGuard();
  }
}

process.on("SIGINT", () => {
  stopping = true;
  console.log("Stopping ListFlow Worker...");
});

process.on("SIGTERM", () => {
  stopping = true;
  console.log("Stopping ListFlow Worker...");
});

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await modules?.prisma.$disconnect();
  releaseLocalWorkerGuard();
  process.exitCode = 1;
});
