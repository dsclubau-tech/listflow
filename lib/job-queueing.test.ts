import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function exportedFunctionSource(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("new background jobs are persisted instead of rejected by active lanes", () => {
  const importSource = readFileSync("lib/ebay-import-jobs.ts", "utf8");
  const researchSource = readFileSync("lib/ebay-research.ts", "utf8");
  const priceSource = readFileSync("lib/price-check-jobs.ts", "utf8");

  assert.doesNotMatch(
    exportedFunctionSource(importSource, "createEbayImportJob"),
    /assertNoEbayLaneStartConflict/,
  );
  assert.doesNotMatch(
    exportedFunctionSource(researchSource, "createEbayResearchJob"),
    /assertNoEbayLaneStartConflict/,
  );
  assert.doesNotMatch(
    exportedFunctionSource(researchSource, "createEbayResearchBatch"),
    /assertNoEbayLaneStartConflict/,
  );
  assert.doesNotMatch(
    exportedFunctionSource(priceSource, "createPriceCheckJob"),
    /assertNoPriceCheckStartConflict/,
  );
});

test("queued eBay imports defer live selection until the worker owns the lane", () => {
  const source = readFileSync("lib/ebay-import-jobs.ts", "utf8");
  const createSource = exportedFunctionSource(source, "createEbayImportJob");

  assert.match(createSource, /buildQueuedEbayImportRequest/);
  assert.doesNotMatch(createSource, /resolveEbayImportSelection/);
  assert.match(source, /skuList: storedMetadata\.skuList/);
  assert.match(source, /sortDirection: storedMetadata\.sortDirection/);
});

test("Products and eBay Import clients allow another job to be queued", () => {
  const productsSource = readFileSync("components/ProductsPageClient.tsx", "utf8");
  const importSource = readFileSync("components/EbayImportClient.tsx", "utf8");
  const priceCheckStart = productsSource.indexOf("const startPriceCheckJob");
  const priceCheckEnd = productsSource.indexOf("const handleCheckPrices", priceCheckStart);
  assert.notEqual(priceCheckStart, -1);
  assert.notEqual(priceCheckEnd, -1);

  assert.doesNotMatch(
    productsSource.slice(priceCheckStart, priceCheckEnd),
    /already running/,
  );
  assert.match(productsSource, /Price check queued for/);
  assert.doesNotMatch(
    importSource.slice(
      importSource.indexOf("const importDisabled"),
      importSource.indexOf("const statsMessage"),
    ),
    /activeImportRunning/,
  );
});

test("upload job creation locks products and reuses active uploads", () => {
  const actionSource = readFileSync("lib/ebay-action-jobs.ts", "utf8");
  const createSource = exportedFunctionSource(
    actionSource,
    "createOrReuseEbayUploadJob",
  );

  assert.match(createSource, /FOR UPDATE/);
  assert.match(createSource, /productIds: \{ hasSome: validProductIds \}/);
  assert.match(createSource, /partitionUploadProductIds/);
  assert.match(createSource, /reused: true/);
});
