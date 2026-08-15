import "dotenv/config";
import { fetchRailwayUsageReport } from "./lib/railway-api";

async function main() {
  const report = await fetchRailwayUsageReport();
  console.log("Configured:", report.configured);
  console.log("Project:", report.projectName);
  console.log("Services count:", report.services.length);
  console.log("Current Period Cost:", report.billingPeriod.currentPeriodCost);
  console.log("Error:", report.error);
}

main().catch(console.error);
