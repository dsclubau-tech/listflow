import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import {
  scrapeAmazonPrice,
  type ScrapedAmazonPrice,
} from "../lib/amazon-scraper";
import {
  amazonPriceComparisonOutcomesMatch,
  normalizeAmazonPriceComparisonOutcome,
  type AmazonPriceComparisonOutcome,
} from "../lib/amazon-price-comparison";
import { createAmazonDeliveryStateSession } from "../lib/amazon-delivery-state";
import { getPriceCheckFailureCode } from "../lib/price-check-failures";
import { launchScraperBrowser } from "../lib/scraper-browser";
import type { AmazonPriceTrackingMode } from "../lib/amazon-price-tracking";
import type { VariantSelectionHints } from "../lib/amazon-variant-selection";

type ComparisonProduct = {
  asin: string;
  priceTrackingMode?: AmazonPriceTrackingMode;
  variantHints?: VariantSelectionHints | null;
  scenario?: string;
};

type ComparisonInput = {
  postcode: string;
  products: ComparisonProduct[];
};

const SCRAPER_COMPARISON_FEATURES = [
  "shared-snapshot",
  "delivery-state",
  "readiness-waits",
] as const;
type ScraperComparisonFeature = (typeof SCRAPER_COMPARISON_FEATURES)[number];

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadInput(filePath: string): ComparisonInput {
  const input = JSON.parse(fs.readFileSync(filePath, "utf8")) as ComparisonInput;
  if (!/^\d{4}$/.test(input.postcode ?? "")) {
    throw new Error("Comparison input postcode must contain exactly four digits.");
  }
  if (!Array.isArray(input.products) || input.products.length !== 30) {
    throw new Error("Comparison input must contain exactly 30 products.");
  }
  for (const [index, product] of input.products.entries()) {
    if (!/^[A-Z0-9]{10}$/i.test(product.asin ?? "")) {
      throw new Error(`Product ${index + 1} has an invalid ASIN.`);
    }
    if (
      product.priceTrackingMode &&
      product.priceTrackingMode !== "REGULAR" &&
      product.priceTrackingMode !== "DEAL"
    ) {
      throw new Error(`Product ${index + 1} has an invalid priceTrackingMode.`);
    }
  }
  return input;
}

function readFeatures(): ScraperComparisonFeature[] {
  const raw =
    readArgument("--features") ?? "shared-snapshot,delivery-state";
  const requested = Array.from(
    new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)),
  );
  const supported = new Set<string>(SCRAPER_COMPARISON_FEATURES);
  const unknown = requested.filter((feature) => !supported.has(feature));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown comparison feature(s): ${unknown.join(", ")}. Allowed: ${SCRAPER_COMPARISON_FEATURES.join(", ")}.`,
    );
  }
  return requested as ScraperComparisonFeature[];
}

function isTechnicalFailure(outcome: AmazonPriceComparisonOutcome) {
  return outcome.kind === "error" && outcome.code === "TECHNICAL_ERROR";
}

async function captureOutcome(
  operation: () => Promise<ScrapedAmazonPrice>,
): Promise<{ outcome: AmazonPriceComparisonOutcome; durationMs: number }> {
  const startedAt = Date.now();
  try {
    return {
      outcome: { kind: "result", value: await operation() },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      outcome: {
        kind: "error",
        code: getPriceCheckFailureCode(error),
        message: error instanceof Error ? error.message : String(error),
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

async function main() {
  const inputArgument = readArgument("--input");
  if (!inputArgument) {
    throw new Error(
      "Usage: npm run price-check:compare -- --input <30-products.json> [--features shared-snapshot,delivery-state,readiness-waits] [--output <report.json>]",
    );
  }

  const inputPath = path.resolve(inputArgument);
  const outputArgument = readArgument("--output");
  const features = readFeatures();
  const input = loadInput(inputPath);
  const deliveryState = features.includes("delivery-state")
    ? createAmazonDeliveryStateSession(input.postcode)
    : undefined;
  const browser = await launchScraperBrowser();
  const deliveryEvents: string[] = [];
  const comparisons = [];

  try {
    for (const [index, product] of input.products.entries()) {
      const mode = product.priceTrackingMode ?? "REGULAR";
      const runBaseline = () =>
        captureOutcome(() =>
          scrapeAmazonPrice(
            product.asin,
            browser,
            input.postcode,
            mode,
            product.variantHints,
          ),
        );
      const runExperiment = () =>
        captureOutcome(() =>
          scrapeAmazonPrice(
            product.asin,
            browser,
            input.postcode,
            mode,
            product.variantHints,
            {
              sharedSnapshot: features.includes("shared-snapshot"),
              deliveryState,
              allowDeliveryStateReuse: features.includes("delivery-state"),
              readinessWaits: features.includes("readiness-waits"),
              onDeliveryStateEvent: (event) =>
                deliveryEvents.push(`${index + 1}:${event}`),
            },
          ),
        );

      const baselineFirst = index % 2 === 0;
      const first = await (baselineFirst ? runBaseline() : runExperiment());
      const second = await (baselineFirst ? runExperiment() : runBaseline());
      const baseline = baselineFirst ? first : second;
      const experiment = baselineFirst ? second : first;

      const match = amazonPriceComparisonOutcomesMatch(
        baseline.outcome,
        experiment.outcome,
      );
      const matchingTechnicalFailure =
        match &&
        isTechnicalFailure(baseline.outcome) &&
        isTechnicalFailure(experiment.outcome);
      comparisons.push({
        index: index + 1,
        asin: product.asin.toUpperCase(),
        scenario: product.scenario ?? null,
        order: baselineFirst ? "baseline-first" : "experiment-first",
        match,
        matchingTechnicalFailure,
        accuracyPass: match && !matchingTechnicalFailure,
        baseline: {
          durationMs: baseline.durationMs,
          outcome: normalizeAmazonPriceComparisonOutcome(baseline.outcome),
        },
        experiment: {
          durationMs: experiment.durationMs,
          outcome: normalizeAmazonPriceComparisonOutcome(experiment.outcome),
        },
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const mismatches = comparisons.filter((comparison) => !comparison.match);
  const matchingTechnicalFailures = comparisons.filter(
    (comparison) => comparison.matchingTechnicalFailure,
  );
  const deliveryReuseObserved = deliveryEvents.some((event) =>
    event.endsWith(":reused"),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    experimentalFeatures: features,
    products: comparisons.length,
    matches: comparisons.length - mismatches.length,
    mismatches: mismatches.length,
    accuracyPasses: comparisons.filter((comparison) => comparison.accuracyPass).length,
    matchingTechnicalFailures: matchingTechnicalFailures.length,
    deliveryReuseRequired: features.includes("delivery-state"),
    deliveryReuseObserved,
    deliveryStateDisabled: deliveryState?.disabled ?? null,
    deliveryStateDisabledReason: deliveryState?.disabledReason ?? null,
    deliveryEvents,
    comparisons,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (outputArgument) {
    fs.writeFileSync(path.resolve(outputArgument), serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }

  if (mismatches.length > 0) {
    process.exitCode = 2;
  } else if (
    matchingTechnicalFailures.length > 0 ||
    (features.includes("delivery-state") && !deliveryReuseObserved)
  ) {
    process.exitCode = 3;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
