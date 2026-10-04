export function formatAmazonDeliveryWait(job: { retryAt?: string | null; checked: number; total: number }) {
  if (!job.retryAt) return null;
  const date = new Date(job.retryAt);
  if (!Number.isFinite(date.getTime())) return null;
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return `Amazon delivery setup unavailable. Retrying at ${time}. Completed ${job.checked} of ${job.total}; remaining products preserved.`;
}

/** Current delivery evidence is separate from a job's historical reason text. */
export function getPriceCheckDeliveryPresentation(
  job: { status: string; retryAt?: string | null; checked: number; total: number },
  hasWorkerAssignment: boolean,
  now = Date.now(),
) {
  if (!["QUEUED", "RUNNING"].includes(job.status) || !job.retryAt) return null;
  const retryTime = Date.parse(job.retryAt);
  if (!Number.isFinite(retryTime)) return null;
  if (job.status === "RUNNING" && hasWorkerAssignment) {
    return { badge: null, message: "Retrying Amazon delivery verification." };
  }
  return {
    badge: "Waiting for Amazon delivery verification",
    message: retryTime > now
      ? formatAmazonDeliveryWait(job)
      : `Amazon delivery verification is due. Completed ${job.checked} of ${job.total}; remaining products preserved.`,
  };
}
