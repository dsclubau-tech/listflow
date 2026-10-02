export function formatAmazonDeliveryWait(job: { retryAt?: string | null; checked: number; total: number }) {
  if (!job.retryAt) return null;
  const date = new Date(job.retryAt);
  if (!Number.isFinite(date.getTime())) return null;
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return `Amazon delivery setup unavailable. Retrying at ${time}. Completed ${job.checked} of ${job.total}; remaining products preserved.`;
}
