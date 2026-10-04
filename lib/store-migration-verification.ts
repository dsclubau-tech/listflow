import type { Prisma, Store } from "@/app/generated/prisma/client";
import { isObjectRecord } from "./error-details";

// Keep these relations aligned with scripts/snapshot-stores.ts.
export const storeMigrationSnapshotInclude = {
  _count: { select: {
    products: true, uploadLogs: true, policyTemplates: true, ebayImportJobs: true,
    priceCheckJobs: true, ebayResearchJobs: true, ebayActionJobs: true, amazonImportJobs: true,
    descriptionTemplates: true, keywordBlacklist: true, supplierSettings: true,
    workerHeartbeats: true, workerSchedules: true, jobLeases: true, appLogs: true,
  } },
} satisfies Prisma.StoreInclude;

const untouchedColumns = [
  "id", "name", "loginId", "password", "ebayToken", "ebayUserId", "ebayStoreId",
  "isActive", "autoCheckEnabled", "autoCheckStartedBy", "autoCheckStartedAt", "createdAt", "updatedAt",
] as const;
const relationKeys = Object.keys(storeMigrationSnapshotInclude._count.select) as
  Array<keyof typeof storeMigrationSnapshotInclude._count.select>;
type Counts = Record<typeof relationKeys[number], number>;
export type MigrationStore = Pick<Store, typeof untouchedColumns[number] | "ownerUserId"> & { _count: Counts };
export type StoreSnapshotRow = Omit<MigrationStore, "ownerUserId" | "autoCheckStartedAt" | "createdAt" | "updatedAt"> & {
  autoCheckStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type StoreMigrationReportRow = {
  storeId: string; name: string; loginId: string | null; products: number; ownerUserId: string;
  updatedAtPreserved: boolean; allColumnsMatch: true; allCountsMatch: true;
};

function assertSnapshotRow(value: unknown, index: number): asserts value is StoreSnapshotRow {
  if (!isObjectRecord(value)) throw new Error(`Invalid store snapshot row ${index}: expected an object.`);
  const invalid = (field: string): never => {
    throw new Error(`Invalid store snapshot row ${index}: missing or malformed '${field}'.`);
  };
  for (const key of ["id", "name"] as const) {
    if (typeof value[key] !== "string") invalid(key);
  }
  for (const key of ["loginId", "password", "ebayToken", "ebayUserId", "ebayStoreId", "autoCheckStartedBy"] as const) {
    if (value[key] !== null && typeof value[key] !== "string") invalid(key);
  }
  for (const key of ["isActive", "autoCheckEnabled"] as const) {
    if (typeof value[key] !== "boolean") invalid(key);
  }
  for (const key of ["createdAt", "updatedAt", "autoCheckStartedAt"] as const) {
    const date = value[key];
    if (key === "autoCheckStartedAt" && date === null) continue;
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) invalid(key);
  }
  const counts = value._count;
  if (!isObjectRecord(counts)) throw new Error(`Invalid store snapshot row ${index}: missing or malformed '_count'.`);
  for (const key of relationKeys) {
    const count = counts[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) invalid(`_count.${key}`);
  }
}

export function parseStoreMigrationSnapshot(value: unknown): StoreSnapshotRow[] {
  if (!Array.isArray(value)) throw new Error("Invalid store snapshot: expected an array of stores.");
  return value.map((row: unknown, index: number) => {
    assertSnapshotRow(row, index);
    return row;
  });
}

export function verifyStoreMigrationSnapshot<T extends MigrationStore>(
  preStores: StoreSnapshotRow[], postStores: T[],
): StoreMigrationReportRow[] {
  if (preStores.length !== postStores.length) {
    throw new Error(`Row count mismatch! Pre-migration had ${preStores.length} stores, post-migration has ${postStores.length}`);
  }
  const postStoreMap = new Map(postStores.map(store => [store.id, store]));
  const diffReport: StoreMigrationReportRow[] = [];
  for (const pre of preStores) {
    const post = postStoreMap.get(pre.id);
    if (!post) throw new Error(`Store with id '${pre.id}' was DELETED!`);
    for (const column of untouchedColumns) {
      const current = post[column];
      const postValue = current instanceof Date ? current.toISOString() : current;
      if (pre[column] !== postValue) {
        // Identify the field without logging passwords or tokens from the snapshot.
        throw new Error(`Data corruption detected on store '${pre.id}' column '${column}'!`);
      }
    }
    for (const key of relationKeys) {
      if (post._count[key] < pre._count[key]) {
        throw new Error(`Data loss detected! Child relation count decreased on store '${pre.id}' for '${key}'! Pre: ${pre._count[key]}, Post: ${post._count[key]}`);
      }
    }
    if (!post.ownerUserId) throw new Error(`Store '${pre.id}' has null or empty ownerUserId post-migration!`);
    diffReport.push({
      storeId: post.id, name: post.name, loginId: post.loginId, products: post._count.products,
      ownerUserId: post.ownerUserId, updatedAtPreserved: Date.parse(pre.updatedAt) === post.updatedAt.getTime(),
      allColumnsMatch: true, allCountsMatch: true,
    });
  }
  return diffReport;
}
