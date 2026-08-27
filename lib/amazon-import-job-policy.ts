import type { WorkerRole } from "@/lib/worker-routing";

export const AMAZON_IMPORT_MAX_ATTEMPTS = 2;

export const AMAZON_IMPORT_RETRY_TARGETS = ["unified", "peer"] as const;

export type AmazonImportRetryTarget =
  (typeof AMAZON_IMPORT_RETRY_TARGETS)[number];

export type AmazonImportRetryPlan = {
  target: AmazonImportRetryTarget;
  requiredWorkerRole: "unified" | "store-specific";
  stage: "RETRYING_ON_UNIFIED_WORKER" | "RETRYING_ON_PEER_WORKER";
};

export function resolveAmazonImportRetryTarget(
  value: string | undefined,
): AmazonImportRetryTarget {
  const normalized = value?.trim().toLowerCase() || "unified";
  if (normalized === "unified" || normalized === "peer") {
    return normalized;
  }

  throw new Error(
    "LISTFLOW_AMAZON_RETRY_TARGET must be unified or peer.",
  );
}

export function getAmazonImportRetryPlan(input: {
  workerRole: WorkerRole;
  attempts: number;
  target?: string;
}): AmazonImportRetryPlan | null {
  if (
    input.workerRole !== "store-specific" ||
    input.attempts >= AMAZON_IMPORT_MAX_ATTEMPTS
  ) {
    return null;
  }

  const target = resolveAmazonImportRetryTarget(input.target);
  return target === "peer"
    ? {
        target,
        requiredWorkerRole: "store-specific",
        stage: "RETRYING_ON_PEER_WORKER",
      }
    : {
        target,
        requiredWorkerRole: "unified",
        stage: "RETRYING_ON_UNIFIED_WORKER",
      };
}

export function isAmazonImportPeerRetry(job: {
  stage: string;
  workerId: string | null;
}) {
  return job.stage === "RETRYING_ON_PEER_WORKER" && Boolean(job.workerId);
}
