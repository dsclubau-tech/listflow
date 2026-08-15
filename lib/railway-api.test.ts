import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const moduleWithLoad = Module as unknown as {
  _load: (
    request: string,
    parent?: unknown,
    isMain?: boolean,
  ) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;

moduleWithLoad._load = function loadWithServerOnlyShim(
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === "server-only") {
    return {};
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

test("calculateServiceCost calculates accurate costs with standard Railway rates", async () => {
  const { calculateServiceCost } = await import("./railway-api");

  // 730 vCPU-hours = 1 vCPU-month = $20
  // 730 GB-hours = 1 GB-month = $10
  // 20 GB egress = 20 * 0.05 = $1.00
  const result = calculateServiceCost(730, 730, 20);

  assert.equal(result.cpuCost, 20.0);
  assert.equal(result.memoryCost, 10.0);
  assert.equal(result.networkEgressCost, 1.0);
  assert.equal(result.totalCost, 31.0);
});

test("calculateServiceCost handles zero usage cleanly", async () => {
  const { calculateServiceCost } = await import("./railway-api");
  const result = calculateServiceCost(0, 0, 0);

  assert.equal(result.cpuCost, 0);
  assert.equal(result.memoryCost, 0);
  assert.equal(result.networkEgressCost, 0);
  assert.equal(result.totalCost, 0);
});

test("calculateServiceCost handles partial decimal hours", async () => {
  const { calculateServiceCost } = await import("./railway-api");

  // 365 vCPU-hours = 0.5 vCPU-month = $10.00
  // 1460 GB-hours = 2.0 GB-months = $20.00
  // 1.5 GB egress = $0.08
  const result = calculateServiceCost(365, 1460, 1.5);

  assert.equal(result.cpuCost, 10.0);
  assert.equal(result.memoryCost, 20.0);
  assert.equal(result.networkEgressCost, 0.08);
  assert.equal(result.totalCost, 30.08);
});
