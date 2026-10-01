import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { configurePostcodeReuseEnvironment, POSTCODE_REUSE_COMMANDS, type PostcodeReuseCommand } from "../lib/price-check-rollout";
import { getPriceCheckOptimizationEnvironmentSummary } from "../lib/price-check-optimizations";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

try {
  const envFile = argument("--env-file");
  const storeId = argument("--store-id");
  const mode = argument("--mode");
  if (!envFile || !mode || !(POSTCODE_REUSE_COMMANDS as readonly string[]).includes(mode)) {
    throw new Error("Usage: tsx scripts/configure-postcode-reuse.ts --env-file .env --mode baseline|enable|disable|all|off [--store-id <database-ID>] [--write]");
  }
  const filePath = path.resolve(envFile);
  const original = fs.readFileSync(filePath, "utf8");
  const result = configurePostcodeReuseEnvironment(original, storeId, mode as PostcodeReuseCommand);
  const write = process.argv.includes("--write");
  if (write) {
    // Configuration was fully validated above; replace the file only after the complete write succeeds.
    const temporary = `${filePath}.postcode-reuse-${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, result.text, { flag: "wx", mode: fs.statSync(filePath).mode });
      fs.renameSync(temporary, filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  console.log(JSON.stringify({
    mode, storeId, written: write, updates: result.updates,
    effective: getPriceCheckOptimizationEnvironmentSummary(parse(result.text), storeId ? [storeId] : []),
  }, null, 2));
  console.log(write
    ? "Configuration saved. Restart workers gracefully after active jobs finish."
    : "Dry run only. Add --write to save these settings after checking the deployment configuration.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not configure postcode reuse.");
  process.exitCode = 1;
}
