import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import { classifyAmazonImportPage, validateAmazonImportResult } from "@/lib/amazon-import-page";

test("Amazon import page classification requires product identity and ignores ordinary busy wording", () => {
  assert.equal(classifyAmazonImportPage('<html><title>Server Busy</title></html>').kind, "TEMPORARY_ERROR");
  assert.equal(classifyAmazonImportPage('<html><meta property="og:title" content="Service Unavailable"></html>').kind, "TEMPORARY_ERROR");
  assert.equal(classifyAmazonImportPage('<html><title>Robot Check</title></html>').kind, "CHALLENGE");
  assert.equal(classifyAmazonImportPage('<html><title>Travel kettle</title><img id="landingImage"></html>').kind, "UNRECOGNIZED");
  assert.deepEqual(classifyAmazonImportPage('<html><title>Busy Families Travel Kettle</title><input id="ASIN" value="B0TEST1234"><img id="landingImage"></html>').kind, "PRODUCT");
});

test("older results with missing optional full title remain readable, but error titles do not", () => {
  assert.equal(validateAmazonImportResult({ title: "Travel kettle", asin: "B0TEST1234" }), null);
  assert.equal(validateAmazonImportResult({ title: "Server Busy", fullTitle: "Server Busy", asin: "B0TEST1234" })?.code, "AMAZON_IMPORT_METADATA_INVALID");
});

test("completed historical busy results are returned as actionable failures", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgresql://audit:audit@localhost:5432/audit";
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (...args: unknown[]) {
    if (args[0] === "server-only") return {};
    return originalLoad.apply(this, args);
  };
  try {
    const { serializeAmazonImportJob } = await import("@/lib/amazon-import-jobs");
    const now = new Date();
    const job = serializeAmazonImportJob({
      id: "old-import", status: "COMPLETED", stage: "COMPLETED", progress: 100,
      result: { title: "Server Busy", fullTitle: "Server Busy", asin: "B0TEST1234" },
      errorMessage: null, errorCode: null, errorStatus: null, workerName: "worker",
      createdAt: now, updatedAt: now, completedAt: now,
    });
    assert.equal(job.status, "FAILED");
    assert.equal(job.result, null);
    assert.equal(job.errorCode, "AMAZON_IMPORT_METADATA_INVALID");
  } finally {
    loader._load = originalLoad;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  }
});
