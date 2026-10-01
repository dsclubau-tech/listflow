import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";
import { parseLocalWorkerStoreLoginIds } from "../lib/local-worker-config";
import { resolveAmazonDeliveryPostcode } from "../lib/amazon-delivery-postcode";
import { extractVariantSelectionHints } from "../lib/amazon-variant-selection";
import { getPriceCheckEligibility } from "../lib/price-check-eligibility";
import { getPriceCheckOptimizationEnvironmentSummary } from "../lib/price-check-optimizations";
import { resolvePriceCheckProductPacing } from "../lib/price-check-pacing";

const loader = Module as unknown as { _load: (name: string, parent?: unknown, main?: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function(name, parent, main) {
  return name === "server-only" ? {} : originalLoad.call(this, name, parent, main);
};
function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
async function main() {
  process.env.LISTFLOW_WORKER_DATABASE_PROFILE = "deployed";
  configureWorkerDatabaseProfile();
  const output = argument("--output");
  if (!output) throw new Error("Use --output <directory> [--inputs].");
  const folder = path.resolve(output);
  fs.mkdirSync(folder, { recursive: true });
  const configuredLogins = parseLocalWorkerStoreLoginIds(process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS);
  const { prisma } = await import("../lib/prisma");
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true, loginId: { in: configuredLogins } },
      select: { id: true, name: true, loginId: true },
      orderBy: { id: "asc" },
    });
    if (stores.length !== configuredLogins.length) throw new Error("One or more configured stores were not found in the deployed database.");
    const configured = parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH || ".env", "utf8"));
    const rolloutKeys = [
      "LISTFLOW_PRICE_CHECK_OPTIMIZATIONS", "LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS",
      "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE", "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS",
      "LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS", "LISTFLOW_PRICE_CHECK_TIMING_ENABLED",
      "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS", "LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS",
      "LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS",
    ];
    const overrides = rolloutKeys.filter(key => process.env[key] !== configured[key] &&
      process.env[key] !== undefined).map(key => ({ key, effective: process.env[key] }));
    const records = [];
    for (const store of stores) {
      const settings = await prisma.supplierSettings.findUnique({
        where: { storeId_supplierName: { storeId: store.id, supplierName: "Amazon AU" } },
        select: { scrapePostcode: true, priceTrackingEnabled: true },
      });
      if (!settings) throw new Error(`Amazon AU settings are missing for ${store.name}; no settings were changed.`);
      const postcode = resolveAmazonDeliveryPostcode(settings.scrapePostcode);
      records.push({ ...store, postcode, priceTrackingEnabled: settings.priceTrackingEnabled });
      if (process.argv.includes("--inputs")) {
        const candidates = await prisma.product.findMany({
          where: { storeId: store.id, status: { in: ["IMPORTED", "ON_HOLD"] }, asin: { not: null }, variants: { some: {} } },
          select: { id: true, asin: true, status: true, amazonPriceTrackingMode: true, itemSpecifics: true,
            variants: { take: 1, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { title: true, itemSpecifics: true } } },
          orderBy: { id: "asc" }, take: 500,
        });
        const buckets = new Map<string, Array<{ asin: string; priceTrackingMode: string; variantHints: ReturnType<typeof extractVariantSelectionHints>; scenario: string }>>();
        const seen = new Set<string>();
        for (const product of candidates) {
          if (!getPriceCheckEligibility(product).eligible) continue;
          const hints = extractVariantSelectionHints(product);
          const asin = product.asin!.trim().toUpperCase();
          const identity = JSON.stringify([asin, product.amazonPriceTrackingMode, hints]);
          if (seen.has(identity)) continue;
          seen.add(identity);
          const scenario = `${product.amazonPriceTrackingMode}/${product.status}/${hints ? "variant" : "standard"}`;
          const bucket = buckets.get(scenario) ?? [];
          bucket.push({ asin, priceTrackingMode: product.amazonPriceTrackingMode, variantHints: hints, scenario });
          buckets.set(scenario, bucket);
        }
        const products = [];
        while (products.length < 30 && Array.from(buckets.values()).some(bucket => bucket.length)) {
          for (const bucket of buckets.values()) {
            if (bucket.length && products.length < 30) products.push(bucket.shift()!);
          }
        }
        if (products.length !== 30) throw new Error(`${store.name} has only ${products.length} distinct eligible comparison observations in the sample. Prepare 30 representative products before activation.`);
        fs.writeFileSync(path.join(folder, `${store.loginId}.input.json`), JSON.stringify({ postcode, products }, null, 2) + "\n");
      }
    }
    const pacing = resolvePriceCheckProductPacing();
    const runtimeFiles = ["lib/price-check-optimizations.ts", "lib/price-checker.ts", "lib/amazon-scraper.ts", "lib/amazon-delivery-state.ts", "scripts/compare-price-check-scrapers.ts"];
    const code = runtimeFiles.map(file => ({ file, hash: createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex") }));
    const fingerprint = createHash("sha256").update(JSON.stringify({ stores: records, pacing, code,
      otherFeatures: (process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS ?? "").split(",").map(value => value.trim()).filter(value => value && value !== "delivery-state"),
      otherStores: process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS ?? "",
    })).digest("hex");
    const result = {
      generatedAt: new Date().toISOString(), databaseProfile: "deployed", cwd: process.cwd(),
      stores: records, pacing, fingerprint, overrides,
      optimizations: getPriceCheckOptimizationEnvironmentSummary(process.env, stores.map(store => store.id)),
    };
    fs.writeFileSync(path.join(folder, "preflight.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    if (overrides.length) throw new Error("Inherited rollout or pacing settings differ from the environment file. Align them before running the rollout.");
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Postcode reuse preflight failed.");
  process.exitCode = 1;
});
