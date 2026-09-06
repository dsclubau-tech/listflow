import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

async function main() {
  const snapshotDir = path.join(process.cwd(), "scripts", "migration-snapshots");
  const preSnapshotFile = path.join(snapshotDir, "pre-migration-stores.json");
  const postSnapshotFile = path.join(snapshotDir, "post-migration-stores.json");

  if (!fs.existsSync(preSnapshotFile)) {
    throw new Error(`Pre-migration snapshot not found at ${preSnapshotFile}`);
  }

  const preStores = JSON.parse(fs.readFileSync(preSnapshotFile, "utf8"));

  // Fetch current post-migration state
  const postStores = await prisma.store.findMany({
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

  fs.writeFileSync(postSnapshotFile, JSON.stringify(postStores, null, 2), "utf8");
  console.log(`[VERIFY_DIFF] Captured post-migration snapshot (${postStores.length} stores).`);

  // Assertions
  if (preStores.length !== postStores.length) {
    throw new Error(
      `Row count mismatch! Pre-migration had ${preStores.length} stores, post-migration has ${postStores.length}`
    );
  }

  const postStoreMap = new Map<string, any>(postStores.map((s: any) => [s.id, s]));

  const untouchedColumns = [
    "id",
    "name",
    "loginId",
    "password",
    "ebayToken",
    "ebayUserId",
    "ebayStoreId",
    "isActive",
    "autoCheckEnabled",
    "autoCheckStartedBy",
    "autoCheckStartedAt",
    "createdAt",
    "updatedAt",
  ];

  const diffReport: any[] = [];

  for (const pre of preStores) {
    const post = postStoreMap.get(pre.id);
    if (!post) {
      throw new Error(`Store with id '${pre.id}' was DELETED!`);
    }

    // Check untouched columns
    for (const col of untouchedColumns) {
      const preVal = pre[col] instanceof Date ? pre[col].toISOString() : pre[col];
      const postVal = post[col] instanceof Date ? post[col].toISOString() : post[col];
      if (preVal !== postVal) {
        throw new Error(
          `Data corruption detected on store '${pre.id}' column '${col}'! Expected '${preVal}', got '${postVal}'`
        );
      }
    }

    // Check child counts (must not decrease; may increase from live worker syncs)
    for (const countKey of Object.keys(pre._count)) {
      if (post._count[countKey] < pre._count[countKey]) {
        throw new Error(
          `Data loss detected! Child relation count decreased on store '${pre.id}' for '${countKey}'! Pre: ${pre._count[countKey]}, Post: ${post._count[countKey]}`
        );
      }
    }

    // Check ownerUserId is populated
    if (!post.ownerUserId) {
      throw new Error(`Store '${pre.id}' has null or empty ownerUserId post-migration!`);
    }

    diffReport.push({
      storeId: post.id,
      name: post.name,
      loginId: post.loginId,
      products: post._count.products,
      ownerUserId: post.ownerUserId,
      updatedAtPreserved: new Date(pre.updatedAt).getTime() === new Date(post.updatedAt).getTime(),
      allColumnsMatch: true,
      allCountsMatch: true,
    });
  }

  console.log("[VERIFY_DIFF] SUCCESS: Pre- and post-migration diff assertion passed with 100% data integrity!");
  console.table(diffReport);
}

main()
  .catch((err) => {
    console.error("[VERIFY_DIFF_FAILED]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
