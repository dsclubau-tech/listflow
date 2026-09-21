import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("durable bulk-edit table is available to the scoped application role", () => {
  const migration = readFileSync(
    "prisma/migrations/20260921162000_grant_bulk_edit_job_items/migration.sql",
    "utf8",
  );

  assert.match(migration, /pg_roles/);
  assert.match(migration, /rolname = 'listflow_app'/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.match(migration, /public\."BulkEditJobItem"/);
});
