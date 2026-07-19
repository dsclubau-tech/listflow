export const ACTIVE_EBAY_ACTION_QUEUE_STATUSES = new Set(["QUEUED", "RUNNING"]);

export type EbayActionQueueJob = {
  id: string;
  status: string;
  createdAt: string | Date;
};

function createdAtTime(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function getEbayActionQueuePositions<T extends EbayActionQueueJob>(
  jobs: readonly T[],
) {
  const activeJobs = jobs
    .filter((job) => ACTIVE_EBAY_ACTION_QUEUE_STATUSES.has(job.status))
    .slice()
    .sort((a, b) => {
      const timeDiff = createdAtTime(a.createdAt) - createdAtTime(b.createdAt);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });

  return new Map(activeJobs.map((job, index) => [job.id, index + 1]));
}

export function getEbayActionStatusLabel(input: {
  status: string;
  queuePosition?: number | null;
}) {
  if (input.status === "QUEUED") {
    return "Queued - waiting for earlier eBay action";
  }

  if (input.status === "RUNNING") {
    return "Running";
  }

  return input.status;
}

export function getEbayActionQueuePositionText(input: {
  status: string;
  queuePosition?: number | null;
}) {
  if (
    !ACTIVE_EBAY_ACTION_QUEUE_STATUSES.has(input.status) ||
    !input.queuePosition
  ) {
    return null;
  }

  return `Queue position ${input.queuePosition}`;
}

export function getEbayActionJobLabel(input: {
  type: string;
  metadata?: unknown;
}) {
  if (
    input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata) &&
    (input.metadata as Record<string, unknown>).kind === "price-check-auto-hold"
  ) {
    return "Auto hold after failed price check";
  }

  if (input.type === "UPLOAD_LISTING") return "Upload listings";
  if (input.type === "REVISE_LISTING") return "Update eBay listing";
  if (input.type === "HOLD") return "Put listings on hold";
  if (input.type === "RESUME") return "Resume listings";
  if (input.type === "END") return "End listings";
  if (input.type === "BULK_EDIT_REVISE") return "Bulk edit listings";
  if (input.type === "MANAGE_PROMOTED_ADS") return "Manage promoted listings";
  return "eBay listing action";
}
