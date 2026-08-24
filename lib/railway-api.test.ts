import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import test from "node:test";

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent?: unknown, isMain?: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === "server-only") return {};
  return originalModuleLoad.call(this, request, parent, isMain);
};

test("billable minute totals use Railway published rates", async () => {
  const { calculateServiceCost } = await import("./railway-api");
  const result = calculateServiceCost(43_200, 43_200, 20);
  assert.equal(result.cpuCost, 20);
  assert.equal(result.memoryCost, 10);
  assert.equal(result.networkEgressCost, 1);
  assert.equal(result.totalCost, 31);
});

test("captured Railway $3.87 fixture reconciles from minute units", async () => {
  const { calculateServiceCost, reconcileRailwayUsage } = await import("./railway-api");
  const estimate = calculateServiceCost(661.46, 12_575.18, 12.97);
  assert.equal(Number(estimate.totalCost.toFixed(2)), 3.87);
  assert.equal(estimate.memoryCost, 2.9109);
  assert.equal(estimate.cpuCost, 0.3062);
  assert.equal(estimate.networkEgressCost, 0.6485);

  const reconciliation = reconcileRailwayUsage(estimate.totalCost, 3.87, true);
  assert.equal(reconciliation.status, "matches");
  assert.equal(reconciliation.tolerance, 0.1161);
});

test("five-minute averages integrate into quantity-minutes", async () => {
  const { integrateFiveMinuteAverageSamples } = await import("./railway-api");
  const result = integrateFiveMinuteAverageSamples(
    [
      { timestamp: "2026-08-11T00:00:00.000Z", value: 1 },
      { timestamp: "2026-08-11T00:05:00.000Z", value: 2 },
    ],
    "2026-08-11T00:00:00.000Z",
    "2026-08-11T00:10:00.000Z",
  );
  assert.equal(result.quantityMinutes, 15);
  assert.equal(result.observedMinutes, 10);
  assert.equal(result.completeness, "complete");
});

test("partial final five-minute interval is clamped to the metric window", async () => {
  const { integrateFiveMinuteAverageSamples } = await import("./railway-api");
  const result = integrateFiveMinuteAverageSamples(
    [
      { timestamp: "2026-08-11T00:00:00.000Z", value: 2 },
      { timestamp: "2026-08-11T00:05:00.000Z", value: 2 },
    ],
    "2026-08-11T00:00:00.000Z",
    "2026-08-11T00:07:00.000Z",
  );
  assert.equal(result.quantityMinutes, 14);
  assert.equal(result.observedMinutes, 7);
  assert.equal(result.completeness, "complete");
});

test("missing samples are marked partial instead of treated as zero", async () => {
  const { integrateFiveMinuteAverageSamples } = await import("./railway-api");
  const result = integrateFiveMinuteAverageSamples(
    [
      { timestamp: "2026-08-11T00:00:00.000Z", value: 1 },
      { timestamp: "2026-08-11T00:10:00.000Z", value: 1 },
    ],
    "2026-08-11T00:00:00.000Z",
    "2026-08-11T00:15:00.000Z",
  );
  assert.equal(result.observedMinutes, 10);
  assert.equal(result.missingIntervals, 1);
  assert.equal(result.completeness, "partial");
});

for (const plan of ["trial", "free", "hobby", "pro"] as const) {
  test(`${plan} reporting periods use Railway dates instead of calendar months`, async () => {
    const { buildReportingPeriod } = await import("./railway-api");
    const period = buildReportingPeriod(
      "2026-08-11T00:00:00.000Z",
      "2026-08-25T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
      plan,
    );
    assert.equal(period.type, plan);
    assert.equal(period.elapsedSeconds, 9 * 86_400);
    assert.equal(period.totalSeconds, 14 * 86_400);
    assert.equal(period.source, "railway.workspace.customer.billingPeriod");
  });
}

test("credit remains unavailable and is never derived from project usage", async () => {
  const { createUnavailableRailwayCredit } = await import("./railway-api");
  const credit = createUnavailableRailwayCredit(
    "workspace-id",
    "trial",
    "2026-08-24T00:00:00.000Z",
  );
  assert.equal(credit.source, "unavailable");
  assert.equal(credit.availableUsd, null);
  assert.equal(credit.expiresAt, null);
  assert.match(credit.dashboardUrl ?? "", /workspace-id/);
  assert.equal("projectUsage" in credit, false);
});

test("four online deployments and one stale heartbeat remain separate counts", async () => {
  const { summarizeWorkerHealth } = await import("./railway-api");
  const health = summarizeWorkerHealth([
    { infrastructureState: "online", heartbeatState: "healthy" },
    { infrastructureState: "online", heartbeatState: "healthy" },
    { infrastructureState: "online", heartbeatState: "healthy" },
    { infrastructureState: "online", heartbeatState: "stale" },
  ]);
  assert.deepEqual(health, {
    online: 4,
    infrastructureKnown: 4,
    heartbeatHealthy: 3,
  });
});

test("projection uses the recent burn rate without a hard-coded fallback", async () => {
  const { calculateProjectedPeriodCost } = await import("./railway-api");
  const result = calculateProjectedPeriodCost(3, 1, 86_400, 2 * 86_400);
  assert.deepEqual(result, { projectedCost: 5, burnPerDay: 1 });
  assert.deepEqual(calculateProjectedPeriodCost(3, null, 86_400, 86_400), {
    projectedCost: null,
    burnPerDay: null,
  });
});

test("Railway UI refresh interval is five minutes", async () => {
  const source = await readFile(
    new URL("../components/RailwayUsageClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /AUTO_REFRESH_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.doesNotMatch(source, /30_000/);
});
