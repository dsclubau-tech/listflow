import "dotenv/config";

import Module from "node:module";
import {
  buildLocalWorkerDefinitions,
  parseLocalWorkerStoreLoginIds,
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

    console.log(
      `Local worker configuration is valid: ${definitions.length} workers for ${requestedLoginIds.length} stores using the ${profile} database profile.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
