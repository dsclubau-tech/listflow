import "dotenv/config";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalWorkerDefinitions,
  getLocalWorkerRestartDelay,
  parseLocalWorkerStoreLoginIds,
  type LocalWorkerDefinition,
} from "../lib/local-worker-config";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logsDir = path.join(repoRoot, "logs");
const supervisorLockPath = path.join(logsDir, "local-workers.supervisor.lock");
const supervisorStopPath = path.join(logsDir, "local-workers.stop");
const stableRuntimeMs = 5 * 60 * 1_000;

type WorkerRuntime = {
  definition: LocalWorkerDefinition;
  child: ChildProcess | null;
  restartAttempt: number;
  restartTimer: NodeJS.Timeout | null;
  stableTimer: NodeJS.Timeout | null;
};

let shuttingDown = false;
let shutdownResolved = false;
let controlTimer: NodeJS.Timeout | null = null;
let resolveShutdown: (() => void) | null = null;
const runtimes: WorkerRuntime[] = [];

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(filePath: string) {
  try {
    return Number.parseInt(fs.readFileSync(filePath, "utf8"), 10);
  } catch {
    return Number.NaN;
  }
}

function acquireSupervisorGuard() {
  fs.mkdirSync(logsDir, { recursive: true });

  if (fs.existsSync(supervisorLockPath)) {
    const existingPid = readPid(supervisorLockPath);
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      throw new Error(
        `The ListFlow local worker supervisor is already running (PID ${existingPid}).`,
      );
    }
    fs.rmSync(supervisorLockPath, { force: true });
  }

  fs.writeFileSync(supervisorLockPath, String(process.pid), { flag: "wx" });
}

function releaseSupervisorGuard() {
  if (readPid(supervisorLockPath) === process.pid) {
    fs.rmSync(supervisorLockPath, { force: true });
  }
}

function writePrefixedOutput(
  definition: LocalWorkerDefinition,
  output: Buffer,
  destination: NodeJS.WriteStream,
) {
  const text = output.toString();
  const prefix = `[${definition.workerId}] `;
  destination.write(prefix + text.replace(/\r?\n(?!$)/g, `\n${prefix}`));
}

function getWorkerStopPath(definition: LocalWorkerDefinition) {
  return path.join(logsDir, definition.stopFileName);
}

function clearTimer(timer: NodeJS.Timeout | null) {
  if (timer) clearTimeout(timer);
}

function maybeFinishShutdown() {
  if (
    shuttingDown &&
    !shutdownResolved &&
    resolveShutdown &&
    runtimes.every(
      (runtime) => runtime.child === null && runtime.restartTimer === null,
    )
  ) {
    shutdownResolved = true;
    resolveShutdown?.();
  }
}

function scheduleWorkerRestart(runtime: WorkerRuntime) {
  const delay = getLocalWorkerRestartDelay(runtime.restartAttempt);
  runtime.restartAttempt += 1;
  console.error(
    `${runtime.definition.workerName} stopped unexpectedly. Restarting in ${Math.round(delay / 1_000)} seconds.`,
  );
  runtime.restartTimer = setTimeout(() => {
    runtime.restartTimer = null;
    startWorker(runtime);
  }, delay);
}

function startWorker(runtime: WorkerRuntime) {
  if (shuttingDown) {
    maybeFinishShutdown();
    return;
  }

  const definition = runtime.definition;
  const workerStopPath = getWorkerStopPath(definition);
  fs.rmSync(workerStopPath, { force: true });

  const logPath = path.join(logsDir, definition.logFileName);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n[${new Date().toISOString()}] Starting ${definition.workerName}\n`);

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/listflow-worker.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        LISTFLOW_WORKER_DATABASE_PROFILE: "deployed",
        LISTFLOW_WORKER_STORE_LOGIN_ID: definition.storeLoginId,
        LISTFLOW_WORKER_ROLE: "store-specific",
        LISTFLOW_WORKER_ID: definition.workerId,
        LISTFLOW_WORKER_NAME: definition.workerName,
        LISTFLOW_WORKER_STOP_FILE: workerStopPath,
        LISTFLOW_AMAZON_RETRY_TARGET: "peer",
        LISTFLOW_USE_LOCAL_PLAYWRIGHT: "true",
        LISTFLOW_SUPABASE_TRANSACTION_POOLER: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  runtime.child = child;
  runtime.stableTimer = setTimeout(() => {
    runtime.restartAttempt = 0;
    runtime.stableTimer = null;
  }, stableRuntimeMs);

  child.stdout.on("data", (chunk: Buffer) => {
    logStream.write(chunk);
    writePrefixedOutput(definition, chunk, process.stdout);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    logStream.write(chunk);
    writePrefixedOutput(definition, chunk, process.stderr);
  });
  child.on("error", (error) => {
    const message = `${definition.workerName} process error: ${error.message}`;
    logStream.write(`${message}\n`);
    console.error(message);
  });
  child.on("close", (code, signal) => {
    clearTimer(runtime.stableTimer);
    runtime.stableTimer = null;
    runtime.child = null;
    logStream.write(
      `[${new Date().toISOString()}] Exited with code ${code ?? "none"}, signal ${signal ?? "none"}\n`,
    );
    logStream.end();

    if (shuttingDown || fs.existsSync(workerStopPath)) {
      maybeFinishShutdown();
    } else {
      scheduleWorkerRestart(runtime);
    }
  });

  console.log(`Started ${definition.workerName} (PID ${child.pid ?? "pending"}).`);
}

function requestShutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Stopping all local ListFlow workers: ${reason}`);

  if (controlTimer) {
    clearInterval(controlTimer);
    controlTimer = null;
  }

  for (const runtime of runtimes) {
    clearTimer(runtime.restartTimer);
    runtime.restartTimer = null;
    fs.writeFileSync(getWorkerStopPath(runtime.definition), "stop", "utf8");
  }

  maybeFinishShutdown();
}

async function loadWorkerDefinitions() {
  process.env.LISTFLOW_WORKER_DATABASE_PROFILE = "deployed";
  const profile = configureWorkerDatabaseProfile();
  const requestedLoginIds = parseLocalWorkerStoreLoginIds(
    process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS,
  );
  const { prisma } = await import("../lib/prisma");

  try {
    await prisma.$queryRaw`SELECT 1`;
    const stores = await prisma.store.findMany({
      where: {
        isActive: true,
        loginId: { in: requestedLoginIds },
      },
      select: { id: true, name: true, loginId: true },
    });
    const definitions = buildLocalWorkerDefinitions(stores, requestedLoginIds);
    return { definitions, profile };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  process.chdir(repoRoot);
  acquireSupervisorGuard();

  try {
    const { definitions, profile } = await loadWorkerDefinitions();
    fs.rmSync(supervisorStopPath, { force: true });
    console.log("ListFlow six-worker supervisor online");
    console.log(`Database profile: ${profile}`);
    console.log(`Workers: ${definitions.length}`);

    for (const definition of definitions) {
      const runtime: WorkerRuntime = {
        definition,
        child: null,
        restartAttempt: 0,
        restartTimer: null,
        stableTimer: null,
      };
      runtimes.push(runtime);
      startWorker(runtime);
    }

    controlTimer = setInterval(() => {
      if (fs.existsSync(supervisorStopPath)) {
        requestShutdown("Stop All requested");
      }
    }, 1_000);

    await new Promise<void>((resolve) => {
      resolveShutdown = resolve;
      maybeFinishShutdown();
    });

    for (const runtime of runtimes) {
      fs.rmSync(getWorkerStopPath(runtime.definition), { force: true });
    }
    fs.rmSync(supervisorStopPath, { force: true });
    console.log("All local ListFlow workers stopped.");
  } finally {
    if (controlTimer) clearInterval(controlTimer);
    releaseSupervisorGuard();
  }
}

process.on("SIGINT", () => requestShutdown("Ctrl+C received"));
process.on("SIGTERM", () => requestShutdown("termination requested"));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
