import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { configureWorkerDatabaseProfile } from "../lib/worker-database-profile";
import { parseLocalWorkerStoreLoginIds } from "../lib/local-worker-config";
import { resolveAmazonDeliveryPostcode } from "../lib/amazon-delivery-postcode";
import { resolvePriceCheckOptimizationConfig } from "../lib/price-check-optimizations";
import { resolvePriceCheckProductPacing, getPriceCheckProductDelayMs } from "../lib/price-check-pacing";
import { launchScraperBrowser } from "../lib/scraper-browser";
import { normalizeAmazonPriceTrackingMode } from "../lib/amazon-price-tracking";
import { extractVariantSelectionHints, type VariantSelectionHints } from "../lib/amazon-variant-selection";
import type { DeliveryFailureDetails, DeliverySetupDiagnostic } from "../lib/amazon-delivery-recovery";
import { withDeliveryDiagnosticProfile, withDeliveryNativeProfile, DELIVERY_DIAGNOSTIC_USER_AGENT } from "./amazon-delivery-repair-browser";

type Sample = { storeId: string; loginId: string; storeName: string; postcode: string;
  products: Array<{ productId: string; asin: string; mode: string; hints: VariantSelectionHints | null }> };
type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> };
function safeProbeError(error: unknown): { name: string; code?: string; causes?: Array<{ name: string; code?: string }> } {
  const value = error as { name?: string; code?: string; errors?: unknown[] };
  const name = typeof value?.name === "string" ? value.name.slice(0, 80) : "ProbeError";
  const code = typeof value?.code === "string" && /^[A-Z0-9_]+$/.test(value.code) ? value.code.slice(0, 80) : undefined;
  return { name, code, causes: value?.errors?.slice(0, 4).map(cause => {
    const child = cause as { name?: string; code?: string };
    return { name: String(child?.name ?? "Error").slice(0, 80),
      code: typeof child?.code === "string" && /^[A-Z0-9_]+$/.test(child.code) ? child.code.slice(0, 80) : undefined };
  }) };
}
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main() {
  const root = process.cwd();
  const output = argument("--output");
  if (!output) throw new Error("Use --output <report.json> [--sample <sample.json>] [--installed].");
  const installed = process.argv.includes("--installed");
  const visible = process.argv.includes("--visible") || process.argv.includes("--native-chrome");
  const diagnosticProfile = process.argv.includes("--diagnostic-profile");
  const nativeChrome = process.argv.includes("--native-chrome");
  const storeLogin = argument("--store-login");
  const requestedOptimization = { features: process.env.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS, mode: process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE };
  process.env.LISTFLOW_WORKER_DATABASE_PROFILE ||= "deployed";
  configureWorkerDatabaseProfile();
  process.env.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = "off";
  const PgPool = (createRequire(path.join(root, "package.json"))("pg") as { Pool: new (options: Record<string, unknown>) => Pool }).Pool;
  const pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000,
    options: "-c default_transaction_read_only=on" });
  let poolClosed = false;
  const pacing = resolvePriceCheckProductPacing();
  const samplePath = argument("--sample") ?? path.join(path.dirname(path.resolve(output)), "sample.json");
  const report: Record<string, unknown> = { format: "listflow-delivery-repair-v1", collectedAt: new Date().toISOString(),
    root, environmentFile: process.env.DOTENV_CONFIG_PATH || ".env", mode: installed ? "installed-baseline" : "repaired-snapshot", node: process.version, readOnly: true, deliveryReuse: false,
    pacing, requestedOptimization, visibleBrowser: visible, nativeChromeProfile: nativeChrome, diagnosticUserAgent: diagnosticProfile ? DELIVERY_DIAGNOSTIC_USER_AGENT : null,
    testedStoreLogin: storeLogin ?? null, executedProbeHash: createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"),
    sourceHashes: {}, observations: [] };
  const runtimeRequire = createRequire(path.join(root, "package.json"));
  const chromium = (runtimeRequire("playwright") as typeof import("playwright")).chromium;
  report.browserDependencies = { playwrightVersion: (runtimeRequire("playwright/package.json") as { version: string }).version,
    selectedChannel: nativeChrome ? "chrome" : "chromium", chromiumExecutable: chromium.executablePath(), chromiumExists: fs.existsSync(chromium.executablePath()) };
  try {
    try { report.revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { report.revision = "unknown"; }
    report.sourceHashes = Object.fromEntries(["lib/amazon-scraper.ts", "lib/price-checker.ts", "lib/price-check-jobs.ts",
      "lib/price-check-item-scheduler.ts", "lib/amazon-delivery-recovery.ts", "lib/amazon-delivery-cooldown.ts"].map(file => {
      const full = path.join(root, file); return [file, fs.existsSync(full) ? createHash("sha256").update(fs.readFileSync(full)).digest("hex") : null];
    }));
    const logins = parseLocalWorkerStoreLoginIds(process.env.LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS);
    const storeRows = (await pool.query(`SELECT s.id, s."loginId", s.name, ss."scrapePostcode" FROM "Store" s
      JOIN "SupplierSettings" ss ON ss."storeId"=s.id AND ss."supplierName"='Amazon AU'
      WHERE s."isActive"=true AND s."loginId"=ANY($1::text[]) ORDER BY s.id`, [logins])).rows;
    if (storeRows.length !== logins.length) throw new Error("Configured stores or Amazon settings are missing; no defaults were created.");
    const sample: Sample[] = fs.existsSync(samplePath) ? JSON.parse(fs.readFileSync(samplePath, "utf8")) : [];
    if (!sample.length) {
      for (const store of storeRows) {
        const products = (await pool.query(`SELECT p.id, p.asin, p."amazonPriceTrackingMode", p."itemSpecifics",
          COALESCE((SELECT json_agg(v) FROM (SELECT title,"itemSpecifics" FROM "Variant" WHERE "productId"=p.id ORDER BY "createdAt",id LIMIT 1) v),'[]') variants
          FROM "Product" p WHERE p."storeId"=$1 AND p.status IN ('IMPORTED','ON_HOLD') AND p.asin IS NOT NULL
          AND EXISTS (SELECT 1 FROM "Variant" WHERE "productId"=p.id) ORDER BY p.id LIMIT 3`, [store.id])).rows;
        sample.push({ storeId: String(store.id), loginId: String(store.loginId), storeName: String(store.name),
          postcode: resolveAmazonDeliveryPostcode(store.scrapePostcode as string | null), products: products.map(product => ({
            productId: String(product.id), asin: String(product.asin), mode: String(product.amazonPriceTrackingMode),
            hints: extractVariantSelectionHints(product as Parameters<typeof extractVariantSelectionHints>[0]) })) });
      }
      fs.mkdirSync(path.dirname(path.resolve(samplePath)), { recursive: true });
      fs.writeFileSync(samplePath, JSON.stringify(sample, null, 2));
    }
    if (sample.length !== storeRows.length || new Set(sample.map(store => store.storeId)).size !== storeRows.length) {
      throw new Error("Saved sample does not cover every configured store exactly once. Collect a fresh baseline.");
    }
    for (const store of sample) {
      const current = storeRows.find(row => row.id === store.storeId);
      if (!current || resolveAmazonDeliveryPostcode(current.scrapePostcode as string | null) !== store.postcode)
        throw new Error("Saved sample store/postcode no longer matches current configuration. Collect a fresh baseline.");
    }
    report.effectiveConfigurations = sample.map(store => ({ storeId: store.storeId, postcode: store.postcode,
      optimization: resolvePriceCheckOptimizationConfig(store.storeId) }));
    // All database reads are finished. Do not keep an idle database socket during browser work.
    await pool.end();
    poolClosed = true;
    const testedSample = storeLogin ? sample.filter(store => store.loginId === storeLogin) : sample;
    if (!testedSample.length) throw new Error("The requested diagnostic store is not configured; no other store was substituted.");
    const scraper: typeof import("../lib/amazon-scraper") = installed
      ? await import(pathToFileURL(path.join(root, "lib/amazon-scraper.ts")).href)
      : await import("../lib/amazon-scraper");
    const observations: Array<Record<string, unknown>> = [];
    report.observations = observations;
    for (const store of testedSample) {
      for (const product of storeLogin ? store.products.slice(0, 1) : store.products) {
        console.log(`Testing ${store.storeName}: ${product.asin} (${visible ? "visible" : "headless"}, read-only).`);
        const launchedBrowser = nativeChrome ? await chromium.launch({ channel: "chrome", headless: false })
          : await launchScraperBrowser({ headless: !visible });
        const browser = nativeChrome ? withDeliveryNativeProfile(launchedBrowser, value => { report.actualNativeUserAgent = value; })
          : diagnosticProfile ? withDeliveryDiagnosticProfile(launchedBrowser) : launchedBrowser;
        report.lastBrowserVersion = launchedBrowser.version();
        const controller = new AbortController();
        const evidence: DeliverySetupDiagnostic[] = [];
        const started = Date.now();
        const originalWarn = console.warn, originalError = console.error;
        const captureLegacyWarning = (...args: unknown[]) => {
          const message = args.filter(value => typeof value === "string" || typeof value === "number").join(" ");
          const httpStatus = Number(message.match(/(?:HTTP\s*|status\s*[:=]?\s*)(\d{3})/i)?.[1]) || undefined;
          if (httpStatus || /address|postcode/i.test(message)) evidence.push({ technicalCode: httpStatus ? "AMAZON_DELIVERY_HTTP_ERROR" : "AMAZON_DELIVERY_RESPONSE_UNRECOGNIZED",
            stage: "legacy-console", requestedPostcode: store.postcode, httpStatus });
        };
        console.warn = captureLegacyWarning; console.error = captureLegacyWarning;
        let timer: NodeJS.Timeout | undefined;
        try {
          const result = await Promise.race([
            scraper.scrapeAmazonPrice(product.asin, browser, store.postcode, normalizeAmazonPriceTrackingMode(product.mode), product.hints,
              { signal: controller.signal, onDeliverySetupDiagnostic: details => evidence.push(details) }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void browser.close(); reject(new Error("Read-only probe timed out after 120 seconds.")); }, 120000); }),
          ]);
          observations.push({ storeId: store.storeId, productId: product.productId, asin: product.asin, postcode: store.postcode,
            result: { price: result.price, rawPrice: result.rawPrice, shippingPrice: result.shippingPrice, stockLeft: result.stockLeft,
              priceMode: result.priceMode, priceChoices: result.priceChoices, detectedAsin: result.detectedAsin,
              identityOutcome: result.identityOutcome, buyBoxOutcome: result.buyBoxOutcome, postcodeVerified: result.postcodeVerified,
              acceptedPriceSource: result.acceptedPriceSource, variantSelectionFailed: result.variantSelectionFailed },
            evidence, elapsedMs: Date.now() - started });
        } catch (error) {
          const failure = error as { message?: string; code?: string; postcodeVerified?: boolean; details?: DeliveryFailureDetails };
          observations.push({ storeId: store.storeId, productId: product.productId, asin: product.asin, postcode: store.postcode,
            failure: { message: failure.message?.slice(0, 500), code: failure.code, postcodeVerified: failure.postcodeVerified, details: failure.details },
            evidence, elapsedMs: Date.now() - started });
          if (!failure.postcodeVerified) break; // No repeated pressure after a shared technical setup failure.
        } finally { console.warn = originalWarn; console.error = originalError; if (timer) clearTimeout(timer); await browser.close().catch(() => {}); }
        await new Promise(resolve => setTimeout(resolve, getPriceCheckProductDelayMs(pacing)));
      }
    }
    const verifiedStores = testedSample.filter(store => observations.some(observation => observation.storeId === store.storeId &&
      ((observation.result as { postcodeVerified?: boolean; identityOutcome?: string })?.postcodeVerified && (observation.result as { identityOutcome?: string }).identityOutcome === "MATCH" || (observation.failure as { postcodeVerified?: boolean }).postcodeVerified && ["AMAZON_PRICE_UNAVAILABLE", "AMAZON_BUYBOX_UNAVAILABLE", "AMAZON_OUT_OF_STOCK"].includes(String((observation.failure as { code?: string }).code)))));
    report.verifiedStoreIds = verifiedStores.map(store => store.storeId);
    report.sampleHasUnrecoveredTechnicalFailure = observations.some(observation => {
      const failure = observation.failure as { code?: string; postcodeVerified?: boolean } | undefined;
      return failure && (!failure.postcodeVerified || failure.code === "TECHNICAL_ERROR");
    });
    report.recoveryVerifiedForTestedStores = testedSample.length > 0 && verifiedStores.length === testedSample.length && !report.sampleHasUnrecoveredTechnicalFailure;
    report.recoveryVerifiedForEveryStore = !storeLogin && report.recoveryVerifiedForTestedStores;
    if (!report.recoveryVerifiedForEveryStore) process.exitCode = 2;
  } catch (error) {
    report.diagnosticFailure = safeProbeError(error);
    throw error;
  } finally {
    if (!poolClosed) {
      try { await pool.end(); }
      catch (error) { report.cleanupFailure = safeProbeError(error); process.exitCode = 1; }
    }
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Safe read-only evidence saved to ${path.resolve(output)}. No product or eBay writes were performed.`);
  }
}
void main().catch(error => { console.error("Diagnostic operation failed:", JSON.stringify(safeProbeError(error))); process.exitCode = 1; });
