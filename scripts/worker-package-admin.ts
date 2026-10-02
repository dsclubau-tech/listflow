import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { chromium } from "playwright";
import { buildLocalWorkerDefinitions, parseLocalWorkerStoreLoginIds } from "../lib/local-worker-config";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";
import { getPriceCheckOptimizationEnvironmentSummary } from "../lib/price-check-optimizations";

// This CLI is read-only. Worker-only modules import the Next.js server-only guard.
const loader = Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const action = process.argv[2];
  if (action !== "preflight" && action !== "status") throw new Error("Use preflight or status.");
  const instance = process.env.LISTFLOW_LOCAL_WORKER_INSTANCE_ID?.trim();
  if (!instance) throw new Error("Worker installation identity is missing from .env.");
  const profile = configureWorkerDatabaseProfile();
  if (profile !== "deployed") throw new Error("The packaged workers require the deployed database profile.");
  const [{ prisma }, { assertWorkerSchemaReady }, { getOrRefreshEntitlement }] = await Promise.all([
    import("../lib/prisma"), import("../lib/worker-schema-check"), import("../lib/aa-entitlement"),
  ]);
  try {
    await prisma.$queryRaw`SELECT 1`;
    await assertWorkerSchemaReady(prisma);
    const logins = parseLocalWorkerStoreLoginIds(process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS);
    const stores = await prisma.store.findMany({
      where: { isActive: true, loginId: { in: logins } },
      select: { id: true, name: true, loginId: true, ownerUserId: true },
    });
    const definitions = buildLocalWorkerDefinitions(stores, logins, instance);
    if (definitions.length !== 6 || stores.length !== 3) throw new Error("Expected two workers for each of three active stores.");
    const ownIds = new Set(definitions.map(item => item.workerId));
    const storeIds = stores.map(store => store.id);
    const optimization = getPriceCheckOptimizationEnvironmentSummary(process.env, storeIds);
    if (process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE !== "all" ||
      optimization.stores.some(store => !store.deliveryStateEnabled)) {
      throw new Error("Postcode reuse is not effectively enabled for every store.");
    }
    const browserExecutable = chromium.executablePath();
    if (!fs.existsSync(browserExecutable)) throw new Error("Matching Playwright Chromium is missing. Run Setup.");
    const now = new Date();
    const [heartbeats, leases] = await Promise.all([
      prisma.workerHeartbeat.findMany({
        where: { storeId: { in: storeIds }, lastSeenAt: { gt: new Date(now.getTime() - 60_000) } },
        select: { storeId: true, workerId: true, revision: true, lastSeenAt: true },
      }),
      prisma.jobLease.findMany({
        where: { storeId: { in: storeIds }, expiresAt: { gt: now } },
        select: { storeId: true, workerId: true, expiresAt: true, jobType: true },
      }),
    ]);
    const foreignHeartbeats = heartbeats.filter(worker => !ownIds.has(worker.workerId));
    const foreignLeases = leases.filter(lease => !ownIds.has(lease.workerId));
    const ownHeartbeats = heartbeats.filter(worker => ownIds.has(worker.workerId));
    if (action === "preflight") {
      if (foreignHeartbeats.length || foreignLeases.length) {
        throw new Error(`Other worker activity remains: ${foreignHeartbeats.length} fresh heartbeats, ${foreignLeases.length} active leases. Stop the other PC and wait for leases to expire.`);
      }
      if (ownHeartbeats.length) throw new Error("This installation already has fresh worker heartbeats. Use Status or Stop.");
      for (const store of stores) {
        if (!store.ownerUserId) continue;
        const entitlement = await getOrRefreshEntitlement(store.ownerUserId);
        const ownerStores = await prisma.store.findMany({
          where: { ownerUserId: store.ownerUserId, isActive: true },
          orderBy: { createdAt: "asc" }, select: { id: true },
        });
        const rank = ownerStores.findIndex(item => item.id === store.id) + 1;
        if (entitlement.status !== "ACTIVE" || rank < 1 || rank > entitlement.allowedStores) {
          throw new Error(`Store ${store.loginId} is not eligible for worker jobs under the current entitlement.`);
        }
      }
    }
    const state = {
      action,
      databaseProfile: profile,
      stores: stores.map(store => ({ loginId: store.loginId, storeId: store.id,
        workers: definitions.filter(item => item.storeId === store.id).map(item => item.workerId),
        deliveryStateEnabled: optimization.stores.find(item => item.storeId === store.id)?.deliveryStateEnabled })),
      browserAvailable: true,
      ownWorkersOnline: ownHeartbeats.length,
      foreignWorkersOnline: foreignHeartbeats.length,
      activeForeignLeases: foreignLeases.length,
      heartbeatRevisions: Array.from(new Set(ownHeartbeats.map(item => item.revision))),
      logDirectory: path.resolve("logs"),
    };
    console.log(JSON.stringify(state, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Worker package check failed.");
  process.exitCode = 1;
});