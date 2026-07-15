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
