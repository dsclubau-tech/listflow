import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("active Action Center jobs use bounded live polling instead of full route refreshes", () => {
  const client = readFileSync("components/ActionCenterClient.tsx", "utf8");

  assert.match(client, /fetch\("\/api\/action-center\/live"/);
  assert.match(client, /requestInFlight/);
  assert.match(client, /ACTIVE_JOB_LIVE_TIMEOUT_MS/);
  assert.match(client, /document\.visibilityState === "hidden"/);
  assert.doesNotMatch(
    client,
    /window\.setInterval\(\(\) => \{\s*router\.refresh\(\)/,
  );
});

test("live Action Center queries omit large per-item job payloads", () => {
  const source = readFileSync("lib/action-center.ts", "utf8");
  const liveQuery = source.slice(source.indexOf("async function loadLiveActionCenterData"));

  assert.match(liveQuery, /prisma\.\$transaction/);
  assert.match(liveQuery, /listflowActionCenterLiveRequests/);
  assert.doesNotMatch(liveQuery, /productIds:\s*true/);
  assert.doesNotMatch(liveQuery, /completedProductIds:\s*true/);
  assert.doesNotMatch(liveQuery, /selectedListingIds:\s*true/);
  assert.doesNotMatch(liveQuery, /completedListingIds:\s*true/);
  assert.doesNotMatch(liveQuery, /activeResults:\s*true/);
  assert.doesNotMatch(liveQuery, /soldResults:\s*true/);
});

test("live Action Center status is isolated behind an authenticated no-store endpoint", () => {
  const route = readFileSync("app/api/action-center/live/route.ts", "utf8");

  assert.match(route, /await auth\(\)/);
  assert.match(route, /getCurrentStoreSession\(\)/);
  assert.match(route, /getLiveActionCenterData\(storeSession\.storeId\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
});

test("reading worker assignments does not issue lease cleanup writes", () => {
  const source = readFileSync("lib/job-coordination.ts", "utf8");
  const reader = source.slice(
    source.indexOf("export async function listActiveJobLeasesForStore"),
    source.indexOf("export async function assertNoPriceCheckStartConflict"),
  );

  assert.match(reader, /jobLease\.findMany/);
  assert.doesNotMatch(reader, /jobLease\.deleteMany/);
});
