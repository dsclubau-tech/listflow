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
      "Usage: npm run price-check:compare -- --input <30-products.json> [--output <report.json>]",
    );
  }

  const inputPath = path.resolve(inputArgument);
  const outputArgument = readArgument("--output");
  const input = loadInput(inputPath);
  const deliveryState = createAmazonDeliveryStateSession(input.postcode);
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
              sharedSnapshot: true,
              deliveryState,
              allowDeliveryStateReuse: true,
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

      comparisons.push({
        index: index + 1,
        asin: product.asin.toUpperCase(),
        scenario: product.scenario ?? null,
        order: baselineFirst ? "baseline-first" : "experiment-first",
        match: amazonPriceComparisonOutcomesMatch(
          baseline.outcome,
          experiment.outcome,
        ),
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
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    products: comparisons.length,
    matches: comparisons.length - mismatches.length,
    mismatches: mismatches.length,
    deliveryStateDisabled: deliveryState.disabled,
    deliveryStateDisabledReason: deliveryState.disabledReason,
    deliveryEvents,
    comparisons,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (outputArgument) {
    fs.writeFileSync(path.resolve(outputArgument), serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }

  if (mismatches.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
