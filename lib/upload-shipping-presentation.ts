import { readShippingConfirmation, record, type UploadShippingConfirmation } from "./amazon-upload-shipping-policy";

export type ShippingUploadDecision = "retry" | "approve" | "cancel";
export type UploadProgressJob = {
  id: string; status: string; productIds: string[]; total: number; processed: number; succeeded: number; failed: number;
  errors?: Array<{ productId: string; error: string; shippingConfirmation?: UploadShippingConfirmation }>;
};

export function readUploadShippingConfirmation(value: unknown, productId: string): UploadShippingConfirmation | null {
  const challenge = readShippingConfirmation(value), row = record(value);
  return challenge?.productId === productId && typeof row.message === "string"
    ? { ...challenge, message: row.message } : null;
}

/** Confirmation is an action required, even though persisted job counters count the attempt as failed. */
export function getUploadOutcomeSummary(job: Pick<UploadProgressJob, "failed" | "errors">) {
  const pending = new Set((job.errors ?? []).filter(error =>
    readUploadShippingConfirmation(error.shippingConfirmation, error.productId)).map(error => error.productId));
  return { awaitingDecision: pending.size, failed: Math.max(0, job.failed - pending.size) };
}

export function findCurrentProductUploadJob<T extends UploadProgressJob>(jobs: T[], productId: string) {
  return jobs.find(job => ["QUEUED", "RUNNING", "CANCELLING"].includes(job.status) && job.productIds.includes(productId)) ??
    jobs.find(job => job.errors?.some(error => error.productId === productId &&
      readUploadShippingConfirmation(error.shippingConfirmation, productId))) ?? null;
}

/** Validate progress returned by the decision endpoint before using it as the new active attempt. */
export function readUploadProgressJob(value: unknown): UploadProgressJob | null {
  const row = record(value);
  const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (typeof row.id !== "string" || !row.id || typeof row.status !== "string" ||
    !Array.isArray(row.productIds) || !row.productIds.every((id): id is string => typeof id === "string") ||
    !count(row.total) || !count(row.processed) || !count(row.succeeded) || !count(row.failed)) return null;
  const errors: NonNullable<UploadProgressJob["errors"]> = [];
  if (Array.isArray(row.errors)) for (const value of row.errors) {
    const error = record(value);
    if (typeof error.productId !== "string" || typeof error.error !== "string") continue;
    const confirmation = readUploadShippingConfirmation(error.shippingConfirmation, error.productId);
    errors.push({ productId: error.productId, error: error.error, ...(confirmation ? { shippingConfirmation: confirmation } : {}) });
  }
  return { id: row.id, status: row.status, productIds: row.productIds, total: row.total,
    processed: row.processed, succeeded: row.succeeded, failed: row.failed, errors };
}
