import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { getPriceCheckProductDelayMs, resolvePriceCheckProductPacing } from "../lib/price-check-pacing";
import { PriceCheckTimingRecorder } from "../lib/price-check-optimizations";
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
      "Usage: npm run price-check:compare -- --input <30-products.json> [--output <report.json>] [--optimizations delivery-state[,shared-snapshot]]",
    );
  }

  const inputPath = path.resolve(inputArgument);
  const outputArgument = readArgument("--output");
  const input = loadInput(inputPath);
  const optimizations = (readArgument("--optimizations") ?? "delivery-state").split(",");
  if (optimizations.some(name => name !== "delivery-state" && name !== "shared-snapshot")) {
    throw new Error("Comparison supports only delivery-state and shared-snapshot.");
  }
  const pacing = resolvePriceCheckProductPacing();
  const startedAt = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const deliveryState = createAmazonDeliveryStateSession(input.postcode);
  const browser = await launchScraperBrowser();
  const deliveryEvents: string[] = [];
  const comparisons = [];
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  let attempts = 0;
  let pacingMs = 0;
  let activeTiming = new PriceCheckTimingRecorder(true);
  const onTiming = (stage: string, durationMs: number) => activeTiming.record(stage, durationMs);
  const pacedCapture = async (operation: () => Promise<ScrapedAmazonPrice>) => {
    controller.signal.throwIfAborted();
    if (attempts++ > 0) {
      const durationMs = getPriceCheckProductDelayMs(pacing);
      pacingMs += durationMs;
      await pause(durationMs, undefined, { signal: controller.signal });
    }
    activeTiming = new PriceCheckTimingRecorder(true);
    const result = await captureOutcome(operation);
    controller.signal.throwIfAborted();
    return { ...result, stages: activeTiming.snapshot().stages };
  };

  try {
    for (const [index, product] of input.products.entries()) {
      const mode = product.priceTrackingMode ?? "REGULAR";
      const runBaseline = () =>
        pacedCapture(() =>
          scrapeAmazonPrice(
            product.asin,
            browser,
            input.postcode,
            mode,
            product.variantHints,
            { onTiming, signal: controller.signal },
          ),
        );
      const runExperiment = () =>
        pacedCapture(() =>
          scrapeAmazonPrice(
            product.asin,
            browser,
            input.postcode,
            mode,
            product.variantHints,
            {
              sharedSnapshot: optimizations.includes("shared-snapshot"),
              deliveryState: optimizations.includes("delivery-state") ? deliveryState : undefined,
              onTiming,
              signal: controller.signal,
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
          stages: baseline.stages,
          outcome: normalizeAmazonPriceComparisonOutcome(baseline.outcome),
        },
        experiment: {
          durationMs: experiment.durationMs,
          stages: experiment.stages,
          outcome: normalizeAmazonPriceComparisonOutcome(experiment.outcome),
        },
      });
      process.stderr.write(`Compared ${index + 1}/30: ${product.asin} (${comparisons.at(-1)?.match ? "match" : "mismatch"})\n`);
    }
  } finally {
    await browser.close().catch(() => {});
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }

  const mismatches = comparisons.filter((comparison) => !comparison.match);
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    products: comparisons.length,
    optimizations,
    pacing,
    pacingMs: Math.round(pacingMs),
    elapsedMs: Date.now() - startedAt,
    baselineScrapeMs: comparisons.reduce((sum, item) => sum + item.baseline.durationMs, 0),
    experimentScrapeMs: comparisons.reduce((sum, item) => sum + item.experiment.durationMs, 0),
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
