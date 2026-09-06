import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

async function main() {
  const snapshotDir = path.join(process.cwd(), "scripts", "migration-snapshots");
  fs.mkdirSync(snapshotDir, { recursive: true });

  const stores = await prisma.store.findMany({
    orderBy: { id: "asc" },
    include: {
      _count: {
        select: {
          products: true,
          uploadLogs: true,
          policyTemplates: true,
          ebayImportJobs: true,
          priceCheckJobs: true,
          ebayResearchJobs: true,
          ebayActionJobs: true,
          amazonImportJobs: true,
          descriptionTemplates: true,
          keywordBlacklist: true,
          supplierSettings: true,
          workerHeartbeats: true,
          workerSchedules: true,
          jobLeases: true,
          appLogs: true,
        },
      },
    },
  });

  const snapshotFile = path.join(snapshotDir, "pre-migration-stores.json");
  fs.writeFileSync(snapshotFile, JSON.stringify(stores, null, 2), "utf8");

  console.log(`[SNAPSHOT] Successfully captured ${stores.length} stores to ${snapshotFile}`);
  console.table(
    stores.map((s) => ({
      id: s.id,
      name: s.name,
      loginId: s.loginId,
      isActive: s.isActive,
      productsCount: s._count.products,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }))
  );
}

main()
  .catch((err) => {
    console.error("[SNAPSHOT_ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
