import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bulk-edit requests queue durable work before any product mutation", () => {
  const route = readFileSync("app/api/products/bulk-edit/route.ts", "utf8");
  assert.match(route, /prepareBulkProductEditJob/);
  assert.match(route, /createEbayActionJob/);
  assert.doesNotMatch(route, /applyBulkProductEdits/);
  assert.ok(route.indexOf("prepareBulkProductEditJob") < route.lastIndexOf("createEbayActionJob"));
  assert.match(route, /requestId/);
  assert.match(route, /itemPayload/);
});

test("durable workers checkpoint originals and restore rejected changes", () => {
  const jobs = readFileSync("lib/ebay-action-jobs.ts", "utf8");
  assert.match(jobs, /captureBulkProductEditSnapshot/);
  assert.match(jobs, /restoreBulkProductEditSnapshot\(snapshot, appliedAt\)/);
  assert.match(jobs, /attempt <= 3/);
  assert.match(jobs, /status: "SUCCEEDED"/);
  assert.match(jobs, /status: "FAILED"/);
  assert.match(jobs, /requestId: input\.requestId/);
  assert.match(jobs, /error\.code === "P2002"/);
});

test("durable bulk-edit migration stores one checkpoint per job and product", () => {
  const migration = readFileSync(
    "prisma/migrations/20260921161000_durable_bulk_edit_jobs/migration.sql",
    "utf8",
  );
  assert.match(migration, /EbayActionJob_storeId_requestId_key/);
  assert.match(migration, /BulkEditJobItem_jobId_productId_key/);
  assert.match(migration, /"payload" JSONB NOT NULL/);
});
