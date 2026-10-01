import fs from "node:fs";
import path from "node:path";
import { comparisonEvidenceFiles, verifyPostcodeReuseComparison } from "../lib/postcode-reuse-rollout-verification";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
try {
  const folder = path.resolve(argument("--folder") || "");
  const currentFolder = argument("--current");
  const original = JSON.parse(fs.readFileSync(path.join(folder, "preflight.json"), "utf8")) as {
    fingerprint: string; pacing: unknown; stores: Array<{ loginId: string; postcode: string }>;
  };
  if (!original.stores.length) throw new Error("No stores in the comparison evidence.");
  for (const store of original.stores) {
    const input = JSON.parse(fs.readFileSync(path.join(folder, `${store.loginId}.input.json`), "utf8"));
    const report = JSON.parse(fs.readFileSync(path.join(folder, `${store.loginId}.report.json`), "utf8"));
    verifyPostcodeReuseComparison(report);
    if (input.postcode !== store.postcode || JSON.stringify(report.pacing) !== JSON.stringify(original.pacing) ||
      report.comparisons.some((item: { asin: string }, index: number) => item.asin !== input.products[index]?.asin)) {
      throw new Error("Comparison postcode, products, or pacing do not match preflight.");
    }
  }
  const files = comparisonEvidenceFiles(folder, original.stores.map(store => store.loginId));
  const evidence = { fingerprint: original.fingerprint, files };
  if (currentFolder) {
    const approved = JSON.parse(fs.readFileSync(path.join(folder, "verified.json"), "utf8"));
    const current = JSON.parse(fs.readFileSync(path.join(path.resolve(currentFolder), "preflight.json"), "utf8"));
    if (current.fingerprint !== original.fingerprint || JSON.stringify(approved.evidence) !== JSON.stringify(evidence)) {
      throw new Error("Code, stores, postcode, pacing, or comparison evidence changed. Run the audit again.");
    }
    console.log("Stored comparisons match the current worker configuration.");
  } else {
    fs.writeFileSync(path.join(folder, "verified.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), evidence }, null, 2) + "\n");
    console.log("All store comparisons verified. Activation is now available.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Comparison verification failed.");
  process.exitCode = 1;
}
