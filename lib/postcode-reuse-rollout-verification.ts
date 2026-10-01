import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function verifyPostcodeReuseComparison(report: {
  products?: number; matches?: number; mismatches?: number; optimizations?: string[];
  deliveryEvents?: string[]; pacing?: unknown;
  comparisons?: Array<{ match?: boolean; experiment?: { outcome?: { kind?: string; postcodeVerified?: boolean; price?: number } } }>;
}) {
  if (report.products !== 30 || report.matches !== 30 || report.mismatches !== 0 ||
    report.comparisons?.length !== 30 || report.comparisons.some(item => item.match !== true)) {
    throw new Error("Every product must match baseline before activation. Investigate comparison differences.");
  }
  if (report.optimizations?.length !== 1 || report.optimizations[0] !== "delivery-state") {
    throw new Error("Compare delivery-state alone.");
  }
  if (!report.deliveryEvents?.some(event => event.endsWith(":reused")) ||
    !report.comparisons.some(item => item.experiment?.outcome?.kind === "result" &&
      item.experiment.outcome.postcodeVerified && (item.experiment.outcome.price ?? 0) > 0)) {
    throw new Error("Comparison did not demonstrate verified postcode reuse and usable prices.");
  }
}

export function comparisonEvidenceFiles(folder: string, loginIds: string[]) {
  return loginIds.flatMap(login => [`${login}.input.json`, `${login}.report.json`]).map(file => ({
    file, hash: createHash("sha256").update(fs.readFileSync(path.join(folder, file))).digest("hex"),
  }));
}
