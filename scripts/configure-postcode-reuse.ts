import fs from "node:fs";
import path from "node:path";
import { configurePostcodeReuseEnvironment } from "../lib/price-check-rollout";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

try {
  const envFile = argument("--env-file");
  const storeId = argument("--store-id");
  const mode = argument("--mode");
  if (!envFile || !storeId || (mode !== "baseline" && mode !== "enable" && mode !== "disable")) {
    throw new Error("Usage: tsx scripts/configure-postcode-reuse.ts --env-file .env --store-id <database-ID> --mode baseline|enable|disable [--write]");
  }
  const filePath = path.resolve(envFile);
  const original = fs.readFileSync(filePath, "utf8");
  const result = configurePostcodeReuseEnvironment(original, storeId, mode);
  const write = process.argv.includes("--write");
  if (write) fs.writeFileSync(filePath, result.text);
  console.log(JSON.stringify({ mode, storeId, written: write, updates: result.updates }, null, 2));
  console.log(write
    ? "Configuration saved. Install matching code and restart workers gracefully after active jobs finish."
    : "Dry run only. Add --write to save these settings after checking the deployment configuration.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not configure postcode reuse.");
  process.exitCode = 1;
}