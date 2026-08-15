import "dotenv/config";

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { isWorkerEnabled } from "../lib/worker-enabled";

function configureWorkerDatabaseProfile() {
  const profile =
    process.env.LISTFLOW_WORKER_DATABASE_PROFILE?.trim().toLowerCase() ||
    "default";

  if (profile === "default") {
    return profile;
  }

  if (profile !== "deployed") {
    throw new Error(`Unsupported worker database profile: ${profile}`);
  }

  const databaseUrl =
    process.env.LISTFLOW_DEPLOYED_DATABASE_URL?.trim() ||
    process.env.MIGRATION_SOURCE_DATABASE_URL?.trim();
  const directUrl =
    process.env.LISTFLOW_DEPLOYED_DIRECT_URL?.trim() ||
    process.env.MIGRATION_SOURCE_DIRECT_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "The deployed worker database URL is missing. Configure LISTFLOW_DEPLOYED_DATABASE_URL or MIGRATION_SOURCE_DATABASE_URL."
    );
  }

  process.env.DATABASE_URL = databaseUrl;
  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  return profile;
}

const workerDatabaseProfile = configureWorkerDatabaseProfile();

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

let workerName = process.env.LISTFLOW_WORKER_NAME || "";
let workerId = process.env.LISTFLOW_WORKER_ID || "";
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
  if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") {
    return;
  }

  const logsDir = path.join(process.cwd(), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const lockPath = path.join(logsDir, `${workerId}.worker.lock`);

  if (fs.existsSync(lockPath)) {
    const existingPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);

    if (
      Number.isFinite(existingPid) &&
      existingPid !== process.pid &&
      isProcessAlive(existingPid)
    ) {
      throw new Error(
        `Another ListFlow Worker window is already running for ${workerName} (${workerId}). Close it before starting a second one.`
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

function parseStoreFilter(): string[] {
  const args = process.argv.slice(2);
  let cliStore: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--store=")) {
      cliStore = arg.slice("--store=".length);
    } else if (arg === "--store" && i + 1 < args.length) {
      cliStore = args[i + 1];
    }
  }

  const raw = cliStore?.trim() || process.env.LISTFLOW_WORKER_STORE_LOGIN_ID?.trim();

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

  if (await modules.runNextEbayActionJobForStore(store.id, worker)) {
    return true;
  }

  if (await modules.runNextPriceCheckJobForStore(store.id, worker)) {
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
  if (!isWorkerEnabled()) {
    console.log(
      "ListFlow Worker is parked because LISTFLOW_WORKER_ENABLED=false."
    );
    console.log("No database connection will be opened and no jobs will be claimed.");

    while (!stopping) {
      await sleep(30_000);
    }

    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add it to .env before starting the worker.");
  }

  modules = await loadWorkerModules();

  const stores = await getActiveStores();
  const storeFilters = parseStoreFilter();

  if (!workerName) {
    if (storeFilters.length === 1 && stores.length === 1) {
      workerName = `${stores[0].name} Worker`;
    } else if (storeFilters.length > 0) {
      workerName = `Store (${storeFilters.join(", ")}) Worker`;
    } else {
      workerName = `${os.hostname()} manual worker`;
    }
  }

  if (!workerId) {
    if (storeFilters.length === 1 && stores.length === 1) {
      const sanitized = (stores[0].loginId || stores[0].id)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");
      workerId = `worker-${sanitized}`;
    } else if (storeFilters.length > 0) {
      const sanitized = storeFilters[0]
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");
      workerId = `worker-${sanitized}`;
    } else {
      workerId = `manual-${os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
    }
  }

  // Update terminal window title
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;ListFlow Worker - ${workerName}\x07`);
  }

  modules.logger = modules.logger.child({
    source: "worker",
    runtime: "worker",
    workerId,
    workerName,
    tags: ["worker"],
  });

  acquireLocalWorkerGuard();

  console.log(`ListFlow Worker online — ${workerName}`);
  console.log(`Worker ID: ${workerId}`);
  console.log(`Database profile: ${workerDatabaseProfile}`);
  console.log("Waiting for jobs...");
  if (STOCK_REPLENISH_ENABLED) {
    console.log(
      `Stock replenish: every ${Math.round(STOCK_REPLENISH_INTERVAL_MS / 60_000)} min`
    );
  }
  modules.logger.info("worker/start", "ListFlow Worker online", {
    workerId,
    workerName,
    storeFilter: storeFilters,
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

  const METRICS_INTERVAL_MS = parsePositiveMs(
    process.env.LISTFLOW_WORKER_METRICS_INTERVAL_MS,
    60_000
  );
  let previousCpu = process.cpuUsage();
  let previousMetricsTime = Date.now();
  let completedJobsSinceMetrics = 0;

  const emitTelemetryMetrics = () => {
    const memory = process.memoryUsage();
    const currentCpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    const now = Date.now();
    const durationSec = Math.max((now - previousMetricsTime) / 1000, 1);
    previousMetricsTime = now;

    const cpuUserMs = Math.round(currentCpu.user / 1000);
    const cpuSystemMs = Math.round(currentCpu.system / 1000);
    const cpuPercent = Number(
      ((cpuUserMs + cpuSystemMs) / (durationSec * 10)).toFixed(1)
    );

    modules.logger.info("worker/metrics", "Worker telemetry snapshot", {
      workerId,
      workerName,
      rssMB: Number((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMB: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMB: Number((memory.heapTotal / (1024 * 1024)).toFixed(2)),
      externalMB: Number((memory.external / (1024 * 1024)).toFixed(2)),
      cpuUserMs,
      cpuSystemMs,
      cpuPercent,
      uptimeSeconds: Math.round(process.uptime()),
      jobsProcessed: completedJobsSinceMetrics,
    });
    completedJobsSinceMetrics = 0;
  };

  const metricsTimer = setInterval(() => {
    try {
      emitTelemetryMetrics();
    } catch (error) {
      console.error(
        "Worker metrics emit failed:",
        error instanceof Error ? error.message : error
      );
    }
  }, METRICS_INTERVAL_MS);

  try {
    while (!stopping) {
      try {
        const currentStores = await getActiveStores();
        heartbeatStoreIds = currentStores.map((store) => store.id);

        for (const store of currentStores) {
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

        if (currentStores.length === 0) {
          console.log("No active stores found for this worker. Waiting...");
          await sleep(IDLE_SLEEP_MS);
          continue;
        }

        await heartbeat();

        let didWork = false;

        for (const store of currentStores) {
          if (stopping) {
            break;
          }

          const storeWork = await processStore(store);
          if (storeWork) {
            completedJobsSinceMetrics += 1;
            didWork = true;
          }
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
    clearInterval(metricsTimer);
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
