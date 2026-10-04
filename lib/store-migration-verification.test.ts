import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStoreMigrationSnapshot, storeMigrationSnapshotInclude, verifyStoreMigrationSnapshot,
  type MigrationStore,
} from "./store-migration-verification";

function store(): MigrationStore {
  return {
    id: "synthetic-store", name: "Test store", loginId: null, password: null, ebayToken: "fake-token",
    ebayUserId: null, ebayStoreId: null, isActive: true, autoCheckEnabled: false, autoCheckStartedBy: null,
    autoCheckStartedAt: null, createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"), ownerUserId: "synthetic-owner",
    _count: { products: 4, uploadLogs: 1, policyTemplates: 0, ebayImportJobs: 0, priceCheckJobs: 0,
      ebayResearchJobs: 0, ebayActionJobs: 0, amazonImportJobs: 0, descriptionTemplates: 0,
      keywordBlacklist: 0, supplierSettings: 0, workerHeartbeats: 0, workerSchedules: 0, jobLeases: 0, appLogs: 0 },
  };
}
function serialized(post = store()): Record<string, unknown> {
  return JSON.parse(JSON.stringify(post));
}
test("valid snapshot supports nullable fields, serialized dates, extra fields, and increased counts", () => {
  const pre = parseStoreMigrationSnapshot([{ ...serialized(), extra: "ignored" }]);
  const post = store();
  post._count.products++;
  const [report] = verifyStoreMigrationSnapshot(pre, [post]);
  assert.equal(report.products, 5);
  assert.equal(report.updatedAtPreserved, true);
  assert.equal(report.ownerUserId, "synthetic-owner");
  assert.equal(report.allColumnsMatch, true);
  assert.equal(report.allCountsMatch, true);
  assert.equal(Object.keys(storeMigrationSnapshotInclude._count.select).length, 15);
});
for (const [field, invalid] of [
  ["id", undefined], ["name", 12], ["loginId", undefined], ["password", 42], ["ebayToken", {}],
  ["isActive", "true"], ["autoCheckEnabled", null], ["createdAt", null], ["updatedAt", "bad-date"],
  ["autoCheckStartedAt", 12], ["_count", null],
] as const) {
  test(`snapshot rejects missing/malformed ${field}`, () => {
    assert.throws(() => parseStoreMigrationSnapshot([{ ...serialized(), [field]: invalid }]), new RegExp(field));
  });
}
for (const value of [null, undefined, {}, "snapshot", [null]]) {
  test(`snapshot rejects malformed root or row: ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseStoreMigrationSnapshot(value), /Invalid store snapshot/);
  });
}
for (const value of [undefined, "4", -1, 1.5, NaN]) {
  test(`snapshot rejects malformed relation count ${String(value)}`, () => {
    const row = serialized();
    assert.throws(() => parseStoreMigrationSnapshot([{ ...row, _count: { ...store()._count, products: value } }]), /_count.products/);
  });
}
test("snapshot rejects a missing required relation but permits unrelated extra relations", () => {
  const counts: Record<string, unknown> = { ...store()._count, futureRelation: 7 };
  parseStoreMigrationSnapshot([{ ...serialized(), _count: counts }]);
  delete counts.appLogs;
  assert.throws(() => parseStoreMigrationSnapshot([{ ...serialized(), _count: counts }]), /_count.appLogs/);
});
for (const column of ["name", "password", "ebayToken"] as const) {
  test(`migration detects changed ${column} without exposing field values`, () => {
    const pre = parseStoreMigrationSnapshot([serialized()]);
    const post = store();
    post[column] = "SECRET_CHANGED_VALUE";
    assert.throws(() => verifyStoreMigrationSnapshot(pre, [post]), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(column));
      assert.equal(error.message.includes("SECRET_CHANGED_VALUE"), false);
      return true;
    });
  });
}
test("migration preserves exact date normalization and detects changed dates", () => {
  const post = store();
  post.autoCheckStartedAt = new Date("2026-01-01T10:00:00+10:00");
  const pre = parseStoreMigrationSnapshot([serialized(post)]);
  verifyStoreMigrationSnapshot(pre, [post]);
  post.updatedAt = new Date("2026-01-03T00:00:00Z");
  assert.throws(() => verifyStoreMigrationSnapshot(pre, [post]), /updatedAt/);
});
test("migration detects row loss, replacement, relation loss, and missing owner", () => {
  const pre = parseStoreMigrationSnapshot([serialized()]);
  assert.throws(() => verifyStoreMigrationSnapshot(pre, []), /Row count mismatch/);
  assert.throws(() => verifyStoreMigrationSnapshot(pre, [{ ...store(), id: "replacement" }]), /DELETED/);
  const post = store();
  post._count.products--;
  assert.throws(() => verifyStoreMigrationSnapshot(pre, [post]), /Child relation count decreased/);
  for (const ownerUserId of [null, ""]) {
    assert.throws(() => verifyStoreMigrationSnapshot(pre, [{ ...store(), ownerUserId }]), /ownerUserId/);
  }
});
