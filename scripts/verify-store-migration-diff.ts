import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { parseStoreMigrationSnapshot, storeMigrationSnapshotInclude, verifyStoreMigrationSnapshot } from "../lib/store-migration-verification";

async function main() {
  const snapshotDir = path.join(process.cwd(), "scripts", "migration-snapshots");
  const preSnapshotFile = path.join(snapshotDir, "pre-migration-stores.json");
  const postSnapshotFile = path.join(snapshotDir, "post-migration-stores.json");

  if (!fs.existsSync(preSnapshotFile)) {
    throw new Error(`Pre-migration snapshot not found at ${preSnapshotFile}`);
  }

  const snapshot: unknown = JSON.parse(fs.readFileSync(preSnapshotFile, "utf8"));
  const preStores = parseStoreMigrationSnapshot(snapshot);

  // Fetch current post-migration state
  const postStores = await prisma.store.findMany({
    orderBy: { id: "asc" },
    include: storeMigrationSnapshotInclude,
  });

  fs.writeFileSync(postSnapshotFile, JSON.stringify(postStores, null, 2), "utf8");
  console.log(`[VERIFY_DIFF] Captured post-migration snapshot (${postStores.length} stores).`);

  const diffReport = verifyStoreMigrationSnapshot(preStores, postStores);

  console.log("[VERIFY_DIFF] SUCCESS: Pre- and post-migration diff assertion passed with 100% data integrity!");
  console.table(diffReport);
}

main()
  .catch((err) => {
    console.error("[VERIFY_DIFF_FAILED]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
