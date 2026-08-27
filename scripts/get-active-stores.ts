import "dotenv/config";
import Module from "node:module";
import { parseLocalWorkerStoreLoginIds } from "../lib/local-worker-config";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
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

async function main() {
  configureWorkerDatabaseProfile();
  const { prisma } = await import("../lib/prisma");
  const localWorkersOnly = process.argv.includes("--local-workers");
  const requestedLoginIds = localWorkersOnly
    ? parseLocalWorkerStoreLoginIds(process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS)
    : [];
  try {
    const stores = await prisma.store.findMany({
      where: {
        isActive: true,
        ...(localWorkersOnly ? { loginId: { in: requestedLoginIds } } : {}),
      },
      select: { id: true, name: true, loginId: true },
      orderBy: { name: "asc" },
    });
    if (localWorkersOnly && stores.length !== requestedLoginIds.length) {
      const found = new Set(stores.map((store) => store.loginId));
      const missing = requestedLoginIds.filter((loginId) => !found.has(loginId));
      throw new Error(`Configured local worker stores are missing or inactive: ${missing.join(", ")}`);
    }
    console.log(JSON.stringify(stores));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Failed to query stores:", err);
  process.exit(1);
});
