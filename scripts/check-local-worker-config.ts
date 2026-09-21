import "dotenv/config";

import Module from "node:module";
import {
  buildLocalWorkerDefinitions,
  parseLocalWorkerStoreLoginIds,
} from "../lib/local-worker-config";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";
import {
  getMissingPriceCheckOptimizationStoreIds,
  resolvePriceCheckOptimizationConfig,
} from "../lib/price-check-optimizations";

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

async function main() {
  process.env.LISTFLOW_WORKER_DATABASE_PROFILE = "deployed";
  const profile = configureWorkerDatabaseProfile();
  const requestedLoginIds = parseLocalWorkerStoreLoginIds(
    process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS,
  );
  const { prisma } = await import("../lib/prisma");

  try {
    await prisma.$queryRaw`SELECT 1`;
    const stores = await prisma.store.findMany({
      where: { isActive: true, loginId: { in: requestedLoginIds } },
      select: { id: true, name: true, loginId: true },
    });
    const definitions = buildLocalWorkerDefinitions(stores, requestedLoginIds);
    const uniqueWorkerIds = new Set(definitions.map((item) => item.workerId));

    if (definitions.length !== requestedLoginIds.length * 2) {
      throw new Error(`Expected ${requestedLoginIds.length * 2} worker definitions.`);
    }
    if (uniqueWorkerIds.size !== definitions.length) {
      throw new Error("Local worker IDs are not unique.");
    }

    const orderedStores = requestedLoginIds.map((loginId) => {
      const store = stores.find((candidate) => candidate.loginId === loginId);
      if (!store) {
        throw new Error(`Configured local worker store is missing: ${loginId}`);
      }
      return store;
    });

    console.log(
      `Local worker configuration is valid: ${definitions.length} workers for ${requestedLoginIds.length} stores using the ${profile} database profile.`,
    );
    console.log("Price-check settings by store:");
    for (const store of orderedStores) {
      const config = resolvePriceCheckOptimizationConfig(store.id);
      console.log(
        JSON.stringify({
          storeName: store.name,
          loginId: store.loginId,
          storeId: store.id,
          timingEnabled: config.timingEnabled,
          requestedOptimizations: config.requested,
          effectiveOptimizations: config.enabled,
          storeAllowed: config.storeAllowed,
          unknownOptimizations: config.unknown,
        }),
      );
    }

    const missingStoreIds = getMissingPriceCheckOptimizationStoreIds(
      orderedStores.map((store) => store.id),
    );
    if (missingStoreIds.length > 0) {
      console.warn(
        `WARNING: ${missingStoreIds.length} configured worker store(s) are absent from LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS: ${missingStoreIds.join(", ")}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
