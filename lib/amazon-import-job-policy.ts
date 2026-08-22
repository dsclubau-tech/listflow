import type { WorkerRole } from "@/lib/worker-routing";

export const AMAZON_IMPORT_MAX_ATTEMPTS = 2;

export function shouldRetryAmazonImportOnUnifiedWorker(input: {
  workerRole: WorkerRole;
  attempts: number;
}) {
  return (
    input.workerRole === "store-specific" &&
    input.attempts < AMAZON_IMPORT_MAX_ATTEMPTS
  );
}
