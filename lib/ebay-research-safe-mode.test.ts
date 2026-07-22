import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Safe Mode batches use the Browse API for every queued search", () => {
  const source = readFileSync("lib/ebay-research.ts", "utf8");

  assert.doesNotMatch(source, /useScrapeForActive/);
  assert.doesNotMatch(source, /scrapeActiveForQueries/);
  assert.match(
    source,
    /fetchActiveForQueries\(job\.storeId, queries, limit, conditionFilter\)/,
  );
});

test("every completed Safe Mode search receives a ten-second cooldown", () => {
  const source = readFileSync("lib/ebay-research.ts", "utf8");
  const functionStart = source.indexOf(
    "async function refreshResearchBatchAndMaybeScheduleCooldown",
  );
  const functionEnd = source.indexOf(
    "async function completeResearchJobFromReusableCache",
    functionStart,
  );
  const functionSource = source.slice(functionStart, functionEnd);

  assert.match(functionSource, /refreshedBatch\.completed \+ refreshedBatch\.failed > 0/);
  assert.match(functionSource, /RESEARCH_BATCH_SEARCH_COOLDOWN_MS/);
  assert.match(source, /RESEARCH_BATCH_SEARCH_COOLDOWN_MS = 10 \* 1000/);
  assert.doesNotMatch(source, /RESEARCH_BATCH_GROUP_SIZE/);
});

test("batch cards use persisted counts without re-filtering or embedding full results", () => {
  const source = readFileSync("lib/ebay-research.ts", "utf8");
  const functionStart = source.indexOf("function serializeEbayResearchBatch");
  const functionEnd = source.indexOf("async function refreshResearchBatch", functionStart);
  const functionSource = source.slice(functionStart, functionEnd);

  assert.match(functionSource, /includeResults: false/);
});

test("opening a completed job returns its stored results without scoring them again", () => {
  const source = readFileSync("lib/ebay-research.ts", "utf8");
  const functionStart = source.indexOf("export function serializeEbayResearchJob");
  const functionEnd = source.indexOf("async function runEbayResearchJobClaimed", functionStart);
  const functionSource = source.slice(functionStart, functionEnd);

  assert.match(functionSource, /asJsonResults\(job\.activeResults\)/);
  assert.match(functionSource, /asJsonResults\(job\.soldResults\)/);
  assert.doesNotMatch(functionSource, /dedupeAndSortResults/);
});

test("batch polling does not overwrite an opened job's full result set", () => {
  const source = readFileSync("components/EbayResearchClient.tsx", "utf8");
  const functionStart = source.indexOf("const refreshBatches");
  const functionEnd = source.indexOf("const fetchJob", functionStart);
  const functionSource = source.slice(functionStart, functionEnd);

  assert.doesNotMatch(functionSource, /setSelectedJob/);
});
