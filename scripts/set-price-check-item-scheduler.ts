import "dotenv/config";
import Module from "node:module";

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown, request: string, parent?: unknown, isMain?: boolean,
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const [storeLoginId, mode] = process.argv.slice(2);
  if (!storeLoginId || (mode && mode !== "--enable" && mode !== "--disable")) {
    throw new Error("Usage: npx tsx scripts/set-price-check-item-scheduler.ts <store-login-id> [--enable|--disable]");
  }
  const { prisma } = await import("../lib/prisma");
  try {
    const store = await prisma.store.findFirst({
      where: { loginId: storeLoginId },
      select: { id: true, name: true, priceCheckItemSchedulerEnabled: true },
    });
    if (!store) throw new Error(`Store ${storeLoginId} was not found.`);
    const activeLegacy = await prisma.priceCheckJob.count({
      where: { storeId: store.id, schedulerVersion: 1,
        status: { in: ["QUEUED", "RUNNING", "CANCELLING"] } },
    });
    const activeItemJobs = await prisma.priceCheckJob.count({
      where: { storeId: store.id, schedulerVersion: 2,
        status: { in: ["QUEUED", "RUNNING", "CANCELLING"] } },
    });
    const workers = await prisma.workerHeartbeat.findMany({
      where: { storeId: store.id, workerRole: "store-specific",
        lastSeenAt: { gt: new Date(Date.now() - 60_000) } },
      select: { workerName: true, revision: true, capabilities: true },
    });
    console.log(JSON.stringify({
      store: store.name, enabled: store.priceCheckItemSchedulerEnabled,
      activeLegacyJobs: activeLegacy,
      activeItemJobs,
      workers: workers.map((worker) => ({ name: worker.workerName,
        revision: worker.revision,
        supportsItemScheduler: worker.capabilities.includes("price-check-items-v2") })),
    }, null, 2));
    if (mode === "--enable") {
      if (activeLegacy > 0) throw new Error("Drain or finish legacy price-check jobs before enabling.");
      const ready = workers.filter((worker) =>
        worker.capabilities.includes("price-check-items-v2") &&
        Boolean(worker.revision) && worker.revision !== "unknown");
      if (workers.length < 2 || ready.length !== workers.length ||
          ready.some((worker) => worker.revision !== ready[0].revision)) {
        throw new Error("Every current store worker must support the item scheduler and share one revision; at least two are required.");
      }
    }
    if (mode === "--disable" && activeItemJobs > 0) {
      throw new Error("Finish or cancel item-scheduled checks before disabling the scheduler.");
    }
    if (mode) {
      const updated = await prisma.store.update({ where: { id: store.id }, data: {
        priceCheckItemSchedulerEnabled: mode === "--enable",
      } });
      console.log(`${updated.name}: item scheduler ${updated.priceCheckItemSchedulerEnabled ? "enabled" : "disabled"}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
