import "dotenv/config";
import Module from "node:module";

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

import { prisma } from "../lib/prisma";

async function main() {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true, loginId: true },
      orderBy: { name: "asc" },
    });
    console.log(JSON.stringify(stores));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Failed to query stores:", err);
  process.exit(1);
});
