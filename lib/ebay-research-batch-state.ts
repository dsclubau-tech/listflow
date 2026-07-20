import {
  EbayResearchBatchStatus,
  EbayResearchJobStatus,
} from "@/app/generated/prisma/enums";

export function isEbayResearchBatchResumable(status: EbayResearchBatchStatus) {
  return (
    status === EbayResearchBatchStatus.PAUSED ||
    status === EbayResearchBatchStatus.PAUSING
  );
}

export function getResumedEbayResearchBatchStatus(
  jobStatuses: readonly EbayResearchJobStatus[]
) {
  return jobStatuses.includes(EbayResearchJobStatus.PAUSING)
    ? EbayResearchBatchStatus.RUNNING
    : EbayResearchBatchStatus.QUEUED;
}
