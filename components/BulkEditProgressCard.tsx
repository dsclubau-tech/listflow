"use client";
import { inventoryJobCounts } from "@/lib/ebay-inventory-job-results";

import ActionProgressBar from "@/components/ActionProgressBar";
import { isActiveBulkEditJob, type BulkEditJob } from "@/hooks/useBulkEditJob";

export function BulkEditJobControl({ job, onOpen }: { job: BulkEditJob | null; onOpen: () => void }) {
  if (!job) return null;
  return (
    <button id="bulk-edit-job-control" type="button" onClick={onOpen}
      className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
      {isActiveBulkEditJob(job) ? "Bulk edit progress" : "Bulk edit results"}
    </button>
  );
}

export default function BulkEditProgressCard({ job, onClose, onView }: {
  job: BulkEditJob;
  onClose: () => void;
  onView: () => void;
}) {
  return (
    <div className="pointer-events-auto order-first w-full rounded-lg border border-blue-200 bg-white p-3 shadow-lg"
      data-bulk-edit-progress-card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ActionProgressBar label={job.status === "CANCELLING" ? "Cancelling bulk edit" : "Bulk edit in progress"}
            percent={job.total ? Math.min(100, Math.round(job.processed / job.total * 100)) : 0}
            detail={`${job.processed}/${job.total} processed (${job.succeeded} succeeded, ${inventoryJobCounts(job).failed} failed${inventoryJobCounts(job).awaitingRestoration ? ", "+inventoryJobCounts(job).awaitingRestoration+" awaiting restoration" : ""}${inventoryJobCounts(job).verification ? ", "+inventoryJobCounts(job).verification+" need verification" : ""})`} tone={inventoryJobCounts(job).awaitingRestoration ? "amber" : "green"} />
        </div>
        <button type="button" aria-label="Close progress notification" onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </div>
      <button id="bulk-edit-view-job" type="button" onClick={onView}
        className="mt-2 text-xs font-semibold text-blue-700 hover:underline">View progress</button>
    </div>
  );
}