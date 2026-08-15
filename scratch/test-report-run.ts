import "dotenv/config";
import Module from "node:module";

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

async function main() {
  const { fetchRailwayUsageReport } = await import("../lib/railway-api");
  const report = await fetchRailwayUsageReport();
  console.log("Configured:", report.configured);
  console.log("Project:", report.projectName);
  console.log("Services count:", report.services.length);
  console.log("Current Period Cost: $" + report.billingPeriod.currentPeriodCost);
  console.log("Error:", report.error);
}

main().catch(console.error);
