"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ActionProgressBar from "@/components/ActionProgressBar";
import AsinLink from "@/components/AsinLink";
import Toast from "@/components/Toast";
import { useTimedActionProgress } from "@/hooks/useTimedActionProgress";
import { useToast } from "@/hooks/useToast";
import {
  buildActiveJobAssignmentIndex,
  getActiveJobAssignment,
  type ActiveJobWorkerAssignment,
} from "@/lib/action-center-job-assignments";
import {
  getEbayActionJobLabel,
  getEbayActionQueuePositionText,
  getEbayActionStatusLabel,
} from "@/lib/ebay-action-queue";
import { isLowStockHoldJobMetadata } from "@/lib/low-stock-products";
import type {
  ActionCenterData,
  ActionCenterProductSummary,
  ActionCenterPriceCheckJob,
  ActionCenterEbayImportJob,
  ActionCenterEbayResearchBatch,
  ActionCenterEbayActionJob,
  FailedCheckActionItem,
  LowStockActionItem,
  OnHoldActionItem,
  PendingReviewActionItem,
} from "@/lib/action-center";

type ToastVariant = "success" | "error";

const ACTIVE_PRICE_JOB_STATUSES = new Set(["QUEUED", "RUNNING", "CANCELLING"]);
const ACTIVE_IMPORT_JOB_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "PAUSING",
  "PAUSED",
  "CANCELLING",
]);
const ACTIVE_ACTION_JOB_STATUSES = new Set(["QUEUED", "RUNNING"]);
const CURRENT_RESEARCH_BATCH_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "PAUSING",
  "PAUSED",
]);
const ACTIVE_RESEARCH_BATCH_STATUSES = new Set(["QUEUED", "RUNNING", "PAUSING"]);
const PRICE_CHECK_JOB_STORAGE_KEY = "listflow.products.activePriceCheckJobId";
const ACTIVE_JOB_ROUTE_REFRESH_MS = 3_000;
type ActionCenterFilter =
  | "pendingReviews"
  | "failedChecks"
  | "lowStock"
  | "onHold"
  | "jobs";
type JobPanelFilter = "current" | "start" | "recent" | "dismissed";
const FILTER_OPTIONS: Array<{
  id: ActionCenterFilter;
  label: string;
  helper: string;
}> = [
  {
    id: "pendingReviews",
    label: "Pending reviews",
    helper: "Price changes",
  },
  {
    id: "failedChecks",
    label: "Failed checks",
    helper: "Needs retry",
  },
  {
    id: "lowStock",
    label: "Low stock",
    helper: "Amazon stock",
  },
  {
    id: "onHold",
    label: "On hold",
    helper: "Paused listings",
  },
  {
    id: "jobs",
    label: "Jobs",
    helper: "Running/recent",
  },
];
const JOB_PANEL_FILTERS: Array<{ id: JobPanelFilter; label: string }> = [
  { id: "current", label: "Current / paused" },
  { id: "start", label: "Start new job" },
  { id: "recent", label: "Recent" },
  { id: "dismissed", label: "Dismissed" },
];

function formatMoney(value: string | number | null) {
  if (value === null) {
    return "-";
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? `A$${parsed.toFixed(2)}` : "-";
}

function formatSignedMoney(value: string | number | null) {
  if (value === null) {
    return "-";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return "-";
  }

  if (parsed > 0) {
    return `+A$${parsed.toFixed(2)}`;
  }

  if (parsed < 0) {
    return `-A$${Math.abs(parsed).toFixed(2)}`;
  }

  return "A$0.00";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) {
    return null;
  }

  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }

  const totalSeconds = Math.round(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatWorkerLastSeen(value: string | null) {
  if (!value) {
    return "Never seen";
  }

  const formatted = formatDateTime(value);
  return formatted === "-" ? "Unknown" : formatted;
}

function productHref(product: ActionCenterProductSummary) {
  return `/products?productId=${encodeURIComponent(product.id)}`;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || "Action failed.");
  }

  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Action failed.");
  }

  return data;
}

function isActivePriceJob(job: ActionCenterPriceCheckJob) {
  return ACTIVE_PRICE_JOB_STATUSES.has(job.status);
}

function isResumablePriceJob(job: ActionCenterPriceCheckJob) {
  return job.status === "CANCELLED" && job.canResume && job.remaining > 0;
}

function isActiveImportJob(job: ActionCenterEbayImportJob) {
  return ACTIVE_IMPORT_JOB_STATUSES.has(job.status);
}

function isActiveActionJob(job: ActionCenterEbayActionJob) {
  return ACTIVE_ACTION_JOB_STATUSES.has(job.status);
}

function isCurrentResearchBatch(batch: ActionCenterEbayResearchBatch) {
  return CURRENT_RESEARCH_BATCH_STATUSES.has(batch.status);
}

function isActiveResearchBatch(batch: ActionCenterEbayResearchBatch) {
  return ACTIVE_RESEARCH_BATCH_STATUSES.has(batch.status);
}

function isTerminalPriceJob(job: ActionCenterPriceCheckJob) {
  return (
    job.status === "COMPLETED" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED"
  );
}

function isTerminalImportJob(job: ActionCenterEbayImportJob) {
  return (
    job.status === "COMPLETED" ||
    job.status === "FAILED" ||
    job.status === "CANCELLED"
  );
}

function getCurrentJobCount(data: ActionCenterData) {
  const currentPriceJobs = data.jobs.priceChecks.filter(
    (job) => !job.dismissedAt && (isActivePriceJob(job) || isResumablePriceJob(job))
  );
  const currentImportJobs = data.jobs.ebayImports.filter(
    (job) => !job.dismissedAt && isActiveImportJob(job)
  );
  const currentResearchBatches = data.jobs.ebayResearchBatches.filter(
    isCurrentResearchBatch
  );
  const currentActionJobs = data.jobs.ebayActions.filter(
    (job) => !job.dismissedAt && isActiveActionJob(job)
  );

  return (
    currentPriceJobs.length +
    currentImportJobs.length +
    currentResearchBatches.length +
    currentActionJobs.length
  );
}

function actionJobLabel(job: ActionCenterEbayActionJob) {
  return getEbayActionJobLabel(job);
}

function actionJobProgressLabel(job: ActionCenterEbayActionJob) {
  return getEbayActionStatusLabel({
    status: job.status,
    queuePosition: job.queuePosition,
  });
}

function actionJobDetail(job: ActionCenterEbayActionJob) {
  const queueText = getEbayActionQueuePositionText({
    status: job.status,
    queuePosition: job.queuePosition,
  });
  const progressText = `${job.processed}/${job.total} processed, ${job.succeeded} succeeded, ${job.failed} failed`;

  return queueText ? `${queueText}. ${progressText}` : progressText;
}

function statusClasses(status: string) {
  if (status === "FAILED") {
    return "bg-red-100 text-red-700";
  }

  if (status === "COMPLETED") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (
    status === "CANCELLED" ||
    status === "CANCELLING" ||
    status === "PAUSED" ||
    status === "PAUSING" ||
    status === "PARTIAL"
  ) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-blue-100 text-blue-700";
}

function ProductLinks({ product }: { product: ActionCenterProductSummary }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {product.asin && (
        <AsinLink
          asin={product.asin}
          className="text-orange-600 hover:text-orange-800"
        >
          Amazon
        </AsinLink>
      )}
      {product.ebayItemId && (
        <a
          href={`https://www.ebay.com.au/itm/${product.ebayItemId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800"
        >
          eBay
        </a>
      )}
      <Link href={productHref(product)} className="text-gray-500 hover:text-gray-900">
        View product
      </Link>
    </div>
  );
}

function EmptyRow({ message, colSpan }: { message: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-gray-500">
        {message}
      </td>
    </tr>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  className?: string;
}) {
  const classes =
    tone === "primary"
      ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
      : tone === "danger"
        ? "border-quaternary bg-quaternary text-white hover:border-quaternary-hover hover:bg-quaternary-hover"
        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${classes} ${className}`}
    >
      {children}
    </button>
  );
}

function SectionHeader({
  title,
  count,
  selectedCount = 0,
  onClearSelection,
  viewAllHref,
  children,
}: {
  title: string;
  count: number;
  selectedCount?: number;
  onClearSelection?: () => void;
  viewAllHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {count}
        </span>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800">
              {selectedCount} selected
            </span>
            {onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                className="text-xs font-medium text-gray-500 hover:text-gray-800 underline transition-colors"
              >
                Deselect all
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            View all
          </Link>
        )}
      </div>
    </div>
  );
}

function getFilterCount(
  summary: ActionCenterData["summary"],
  data: ActionCenterData,
  filter: ActionCenterFilter
) {
  if (filter === "pendingReviews") {
    return summary.pendingReviews;
  }

  if (filter === "failedChecks") {
    return summary.failedChecks;
  }

  if (filter === "lowStock") {
    return summary.lowStock;
  }

  if (filter === "onHold") {
    return summary.onHold;
  }

  return getCurrentJobCount(data);
}

function hasFilterContent(
  queues: {
    pendingReviews: unknown[];
    failedChecks: unknown[];
    lowStock: unknown[];
    onHold: unknown[];
  },
  data: ActionCenterData,
  filter: ActionCenterFilter
) {
  if (filter === "pendingReviews") {
    return queues.pendingReviews.length > 0;
  }

  if (filter === "failedChecks") {
    return queues.failedChecks.length > 0;
  }

  if (filter === "lowStock") {
    return queues.lowStock.length > 0;
  }

  if (filter === "onHold") {
    return queues.onHold.length > 0;
  }

  return (
    data.jobs.priceChecks.length > 0 ||
    data.jobs.ebayImports.length > 0 ||
    data.jobs.ebayResearchBatches.length > 0 ||
    data.jobs.ebayActions.length > 0
  );
}

function getDefaultFilter(
  queues: {
    pendingReviews: unknown[];
    failedChecks: unknown[];
    lowStock: unknown[];
    onHold: unknown[];
  },
  data: ActionCenterData
): ActionCenterFilter {
  return (
    FILTER_OPTIONS.find((option) => hasFilterContent(queues, data, option.id))?.id ??
    "pendingReviews"
  );
}

function JobWorkerAssignment({
  assignment,
  status,
}: {
  assignment: ActiveJobWorkerAssignment | null;
  status: string;
}) {
  if (assignment) {
    return (
      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
        Worker: {assignment.workerName}
      </span>
    );
  }

  const paused = status === "PAUSED" || status === "CANCELLED";

  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {paused
        ? "No active worker"
        : status === "QUEUED"
          ? "Waiting for worker"
          : "Worker assignment pending"}
    </span>
  );
}

function ResearchBatchWorkerAssignments({
  batch,
  assignments,
}: {
  batch: ActionCenterEbayResearchBatch;
  assignments: Map<string, ActiveJobWorkerAssignment>;
}) {
  const claimedJobs = batch.jobs.flatMap((job) => {
    const assignment = getActiveJobAssignment(
      assignments,
      "EBAY_RESEARCH",
      job.id,
    );

    return assignment ? [{ job, assignment }] : [];
  });

  if (claimedJobs.length === 0) {
    return (
      <div className="mt-2">
        <JobWorkerAssignment assignment={null} status={batch.status} />
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {claimedJobs.map(({ job, assignment }) => (
        <div
          key={job.id}
          className="flex max-w-xl flex-wrap items-center gap-2 text-xs text-gray-600"
        >
          <span className="max-w-72 truncate" title={job.query}>
            {job.query}
          </span>
          <JobWorkerAssignment assignment={assignment} status={job.status} />
        </div>
      ))}
    </div>
  );
}

export default function ActionCenterClient({ data }: { data: ActionCenterData }) {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const runningActionProgress = useTimedActionProgress(Boolean(runningAction), {
    initialPercent: 12,
    maxWaitingPercent: 90,
  });
  const [dismissedProductIds, setDismissedProductIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setDismissedProductIds(new Set());
  }, [data]);

  const activeQueues = useMemo(
    () => ({
      pendingReviews: data.queues.pendingReviews.filter(
        (item) => !dismissedProductIds.has(item.product.id)
      ),
      failedChecks: data.queues.failedChecks.filter(
        (item) => !dismissedProductIds.has(item.product.id)
      ),
      lowStock: data.queues.lowStock.filter(
        (item) => !dismissedProductIds.has(item.product.id)
      ),
      onHold: data.queues.onHold.filter(
        (item) => !dismissedProductIds.has(item.product.id)
      ),
    }),
    [data.queues, dismissedProductIds]
  );

  const adjustedSummary = useMemo(() => {
    if (dismissedProductIds.size === 0) {
      return data.summary;
    }
    return {
      ...data.summary,
      pendingReviews: Math.max(
        0,
        data.summary.pendingReviews -
          (data.queues.pendingReviews.length - activeQueues.pendingReviews.length)
      ),
      failedChecks: Math.max(
        0,
        data.summary.failedChecks -
          (data.queues.failedChecks.length - activeQueues.failedChecks.length)
      ),
      lowStock: Math.max(
        0,
        data.summary.lowStock -
          (data.queues.lowStock.length - activeQueues.lowStock.length)
      ),
      onHold: Math.max(
        0,
        data.summary.onHold -
          (data.queues.onHold.length - activeQueues.onHold.length)
      ),
    };
  }, [data.summary, data.queues, activeQueues, dismissedProductIds.size]);

  const [activeFilter, setActiveFilter] = useState<ActionCenterFilter>(() =>
    getDefaultFilter(data.queues, data)
  );
  const [jobPanelFilter, setJobPanelFilter] =
    useState<JobPanelFilter>("current");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const activeJobAssignments = useMemo(
    () => buildActiveJobAssignmentIndex(data.workers),
    [data.workers],
  );

  const visibleProductIds = useMemo(() => {
    if (activeFilter === "pendingReviews") {
      return activeQueues.pendingReviews.map((item) => item.product.id);
    }
    if (activeFilter === "failedChecks") {
      return activeQueues.failedChecks.map((item) => item.product.id);
    }
    if (activeFilter === "lowStock") {
      return activeQueues.lowStock.map((item) => item.product.id);
    }
    if (activeFilter === "onHold") {
      return activeQueues.onHold.map((item) => item.product.id);
    }
    return [];
  }, [activeFilter, activeQueues]);

  const selectedInActiveTab = useMemo(() => {
    const visibleSet = new Set(visibleProductIds);
    return selectedProductIds.filter((id) => visibleSet.has(id));
  }, [selectedProductIds, visibleProductIds]);

  const isAllSelected =
    visibleProductIds.length > 0 &&
    visibleProductIds.every((id) => selectedInActiveTab.includes(id));
  const isSomeSelected =
    selectedInActiveTab.length > 0 && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds([...visibleProductIds]);
    }
  };

  const toggleSelectProduct = (productId: string) => {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  };

  const clearSelection = () => {
    setSelectedProductIds([]);
  };

  const activePriceJobs = useMemo(
    () => data.jobs.priceChecks.filter(isActivePriceJob),
    [data.jobs.priceChecks]
  );
  const currentPriceJobs = useMemo(
    () =>
      data.jobs.priceChecks.filter(
        (job) => !job.dismissedAt && (isActivePriceJob(job) || isResumablePriceJob(job))
      ),
    [data.jobs.priceChecks]
  );
  const activeImportJobs = useMemo(
    () => data.jobs.ebayImports.filter((job) => !job.dismissedAt && isActiveImportJob(job)),
    [data.jobs.ebayImports]
  );
  const currentActionJobs = useMemo(
    () => data.jobs.ebayActions.filter((job) => !job.dismissedAt && isActiveActionJob(job)),
    [data.jobs.ebayActions]
  );
  const hasActiveLowStockHoldJob = useMemo(
    () =>
      currentActionJobs.some(
        (job) => job.type === "HOLD" && isLowStockHoldJobMetadata(job.metadata)
      ),
    [currentActionJobs]
  );
  const currentResearchBatches = useMemo(
    () => data.jobs.ebayResearchBatches.filter(isCurrentResearchBatch),
    [data.jobs.ebayResearchBatches]
  );
  const activeResearchBatches = useMemo(
    () => data.jobs.ebayResearchBatches.filter(isActiveResearchBatch),
    [data.jobs.ebayResearchBatches]
  );
  const recentPriceJobs = useMemo(
    () => data.jobs.priceChecks.filter((job) => !job.dismissedAt),
    [data.jobs.priceChecks]
  );
  const recentImportJobs = useMemo(
    () => data.jobs.ebayImports.filter((job) => !job.dismissedAt),
    [data.jobs.ebayImports]
  );
  const recentActionJobs = useMemo(
    () => data.jobs.ebayActions.filter((job) => !job.dismissedAt),
    [data.jobs.ebayActions]
  );
  const recentResearchBatches = useMemo(
    () => data.jobs.ebayResearchBatches,
    [data.jobs.ebayResearchBatches]
  );
  const dismissedPriceJobs = useMemo(
    () => data.jobs.priceChecks.filter((job) => Boolean(job.dismissedAt)),
    [data.jobs.priceChecks]
  );
  const dismissedImportJobs = useMemo(
    () => data.jobs.ebayImports.filter((job) => Boolean(job.dismissedAt)),
    [data.jobs.ebayImports]
  );
  const hasActivePriceJobs = activePriceJobs.length > 0;
  const hasActiveJobs = useMemo(
    () =>
      activePriceJobs.length > 0 ||
      activeImportJobs.length > 0 ||
      activeResearchBatches.length > 0 ||
      currentActionJobs.length > 0,
    [
      activeImportJobs.length,
      activePriceJobs.length,
      activeResearchBatches.length,
      currentActionJobs.length,
    ]
  );
  const workerOffline = !data.worker.online;
  const workerMessage =
    data.worker.message ??
    "Worker offline. Open Start ListFlow Worker on PC 1 to run long jobs.";

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, ACTIVE_JOB_ROUTE_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [hasActiveJobs, router]);

  useEffect(() => {
    if (hasFilterContent(activeQueues, data, activeFilter)) {
      return;
    }

    setActiveFilter(getDefaultFilter(activeQueues, data));
  }, [activeFilter, activeQueues, data]);

  async function runAction(
    key: string,
    task: () => Promise<string>,
    variant: ToastVariant = "success",
    affectedProductIds?: string[]
  ) {
    setRunningAction(key);

    try {
      const message = await task();
      if (affectedProductIds && affectedProductIds.length > 0) {
        setDismissedProductIds((prev) => {
          const next = new Set(prev);
          for (const id of affectedProductIds) {
            next.add(id);
          }
          return next;
        });
        setSelectedProductIds((prev) =>
          prev.filter((id) => !affectedProductIds.includes(id))
        );
      }
      showToast(message, variant);
      router.refresh();
      setTimeout(() => {
        router.refresh();
      }, 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed.";
      showToast(message, "error");
    } finally {
      setRunningAction(null);
    }
  }

  function applyReview(item: PendingReviewActionItem) {
    void runAction(
      `apply:${item.product.id}`,
      async () => {
        await postJson("/api/price-check/apply", { productId: item.product.id });
        return "Applied pending price change.";
      },
      "success",
      [item.product.id]
    );
  }

  function dismissReview(item: PendingReviewActionItem) {
    void runAction(
      `dismiss:${item.product.id}`,
      async () => {
        await postJson("/api/price-check/dismiss", { productId: item.product.id });
        return "Dismissed pending price change.";
      },
      "success",
      [item.product.id]
    );
  }

  function bulkReview(action: "apply" | "dismiss", explicitProductIds?: string[]) {
    const productIds =
      explicitProductIds && explicitProductIds.length > 0
        ? explicitProductIds
        : activeQueues.pendingReviews.map((item) => item.product.id);
    const endpoint =
      action === "apply" ? "/api/price-check/bulk-apply" : "/api/price-check/bulk-dismiss";

    void runAction(
      `bulk-${action}`,
      async () => {
        if (productIds.length === 0) {
          return "No pending reviews selected.";
        }

        const result = await postJson<{
          applied?: number;
          dismissed?: number;
          failed?: number;
        }>(endpoint, { productIds });

        if (action === "apply") {
          return `Applied ${result.applied ?? 0} price change(s). ${result.failed ?? 0} failed.`;
        }

        return `Dismissed ${result.dismissed ?? 0} price change(s).`;
      },
      "success",
      productIds
    );
  }

  function startPriceCheckJob(
    key: string,
    body: { all?: boolean; productIds?: string[] },
    emptyMessage: string,
    startedLabel: (total: number) => string
  ) {
    void runAction(key, async () => {
      if (!body.all && (!body.productIds || body.productIds.length === 0)) {
        return emptyMessage;
      }

      const result = await postJson<{
        job?: ActionCenterPriceCheckJob;
        reused?: boolean;
      }>("/api/price-check/jobs", body);

      if (result.job && isActivePriceJob(result.job)) {
        window.localStorage.setItem(PRICE_CHECK_JOB_STORAGE_KEY, result.job.id);
        setJobPanelFilter("current");
      }

      if (result.reused) {
        return "Price check is queued.";
      }

      const total = result.job?.total ?? 0;
      return startedLabel(total);
    });
  }

  function retryCheck(product: ActionCenterProductSummary) {
    startPriceCheckJob(
      `retry:${product.id}`,
      { productIds: [product.id] },
      "No product selected.",
      (total) => `Price check started for ${total} product${total === 1 ? "" : "s"}.`
    );
  }

  function bulkRetryFailedChecks(explicitProductIds?: string[]) {
    const targetProductIds =
      explicitProductIds && explicitProductIds.length > 0
        ? explicitProductIds
        : activeQueues.failedChecks.map((item) => item.product.id);

    if (targetProductIds.length === 0) {
      showToast("No failed price checks to retry.", "error");
      return;
    }

    startPriceCheckJob(
      "bulk-retry",
      { productIds: targetProductIds },
      "No failed price checks to retry.",
      (total) => `Price check started for ${total} product${total === 1 ? "" : "s"}.`
    );
    setSelectedProductIds([]);
  }

  function holdProduct(product: ActionCenterProductSummary) {
    void runAction(
      `hold:${product.id}`,
      async () => {
        const result = await postJson<{ held?: number; failed?: number; message?: string }>(
          "/api/products/bulk-hold",
          { productIds: [product.id] }
        );
        if (result.message) return result.message;
        return `Put ${result.held ?? 0} product(s) on hold. ${result.failed ?? 0} failed.`;
      },
      "success",
      [product.id]
    );
  }

  function bulkHoldProducts(explicitProductIds?: string[]) {
    const targetProductIds =
      explicitProductIds && explicitProductIds.length > 0
        ? explicitProductIds
        : visibleProductIds;

    if (targetProductIds.length === 0) {
      showToast("No products selected to put on hold.", "error");
      return;
    }

    void runAction(
      "bulk-hold",
      async () => {
        const result = await postJson<{ held?: number; failed?: number; message?: string }>(
          "/api/products/bulk-hold",
          { productIds: targetProductIds }
        );
        if (result.message) return result.message;
        return `Put ${result.held ?? 0} product(s) on hold. ${result.failed ?? 0} failed.`;
      },
      "success",
      targetProductIds
    );
  }

  function holdAllLowStockProducts() {
    const lowStockCount = adjustedSummary.lowStock;
    const confirmed = window.confirm(
      `Put all ${lowStockCount} low-stock product(s) on hold? This sets their eBay listing quantity to 0 and hides them from eBay search results.`
    );

    if (!confirmed) {
      return;
    }

    const allLowStockIds = activeQueues.lowStock.map((i) => i.product.id);
    void runAction(
      "hold-all-low-stock",
      async () => {
        const result = await postJson<{
          total?: number;
          message?: string;
        }>("/api/products/bulk-hold", { allLowStock: true });
        return (
          result.message ??
          `Queued ${result.total ?? 0} low-stock product(s) to put on hold.`
        );
      },
      "success",
      allLowStockIds
    );
  }

  function resumeProduct(product: ActionCenterProductSummary) {
    void runAction(
      `resume:${product.id}`,
      async () => {
        const result = await postJson<{ resumed?: number; failed?: number; message?: string }>(
          "/api/products/bulk-resume",
          { productIds: [product.id] }
        );
        if (result.message) return result.message;
        return `Resumed ${result.resumed ?? 0} product(s). ${result.failed ?? 0} failed.`;
      },
      "success",
      [product.id]
    );
  }

  function bulkResumeProducts(explicitProductIds?: string[]) {
    const productIds =
      explicitProductIds && explicitProductIds.length > 0
        ? explicitProductIds
        : activeQueues.onHold.map((item) => item.product.id);

    if (productIds.length === 0) {
      showToast("No products selected to resume.", "error");
      return;
    }

    void runAction(
      "bulk-resume",
      async () => {
        const result = await postJson<{ resumed?: number; failed?: number; message?: string }>(
          "/api/products/bulk-resume",
          { productIds }
        );
        if (result.message) return result.message;
        return `Resumed ${result.resumed ?? 0} product(s). ${result.failed ?? 0} failed.`;
      },
      "success",
      productIds
    );
  }

  function endProduct(product: ActionCenterProductSummary) {
    const confirmed = window.confirm(
      `End this eBay listing and delete it from ListFlow?\n\n${product.title}`
    );

    if (!confirmed) {
      return;
    }

    void runAction(
      `end:${product.id}`,
      async () => {
        const result = await postJson<{ ended?: number; failed?: number; message?: string }>(
          "/api/products/bulk-end",
          { productIds: [product.id] }
        );
        if (result.message) return result.message;
        return `Ended ${result.ended ?? 0} listing(s). ${result.failed ?? 0} failed.`;
      },
      "success",
      [product.id]
    );
  }

  function bulkEndProducts(explicitProductIds?: string[]) {
    const targetProductIds =
      explicitProductIds && explicitProductIds.length > 0
        ? explicitProductIds
        : visibleProductIds;

    if (targetProductIds.length === 0) {
      showToast("No products selected to end.", "error");
      return;
    }

    const confirmed = window.confirm(
      `End and delete ${targetProductIds.length} selected eBay listing(s) from ListFlow?\n\nThis action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    void runAction(
      "bulk-end",
      async () => {
        const result = await postJson<{ ended?: number; failed?: number; message?: string }>(
          "/api/products/bulk-end",
          { productIds: targetProductIds }
        );
        if (result.message) return result.message;
        return `Ended ${result.ended ?? 0} listing(s). ${result.failed ?? 0} failed.`;
      },
      "success",
      targetProductIds
    );
  }

  function cancelPriceJob(job: ActionCenterPriceCheckJob, force = false) {
    const isForce = force || job.status === "CANCELLING";
    void runAction(`stop-job:${job.id}`, async () => {
      await postJson(`/api/price-check/jobs/${job.id}/cancel`, { force: isForce });
      return isForce
        ? "Price check force-cancelled."
        : "Pausing price check after current product.";
    });
  }

  function resumePriceJob(job: ActionCenterPriceCheckJob) {
    void runAction(`resume-job:${job.id}`, async () => {
      const result = await postJson<{
        job?: ActionCenterPriceCheckJob;
        reused?: boolean;
        resumed?: boolean;
      }>(`/api/price-check/jobs/${job.id}/resume`);

      if (result.job && isActivePriceJob(result.job)) {
        window.localStorage.setItem(PRICE_CHECK_JOB_STORAGE_KEY, result.job.id);
        setJobPanelFilter("current");
      }

      if (result.reused) {
        return "Price check is queued.";
      }

      if (result.resumed && result.job) {
        return `Resumed price check for ${result.job.total} product${result.job.total === 1 ? "" : "s"}.`;
      }

      return "No remaining products to resume.";
    });
  }

  function dismissPriceJob(job: ActionCenterPriceCheckJob) {
    void runAction(`dismiss-price-job:${job.id}`, async () => {
      await postJson<{ job?: ActionCenterPriceCheckJob }>(
        `/api/price-check/jobs/${job.id}/dismiss`
      );
      window.localStorage.removeItem(PRICE_CHECK_JOB_STORAGE_KEY);
      return "Price check job dismissed.";
    });
  }

  function dismissImportJob(job: ActionCenterEbayImportJob) {
    void runAction(`dismiss-import-job:${job.id}`, async () => {
      await postJson<{ job?: ActionCenterEbayImportJob }>(
        `/api/ebay-import/jobs/${job.id}/dismiss`
      );
      return "eBay import job dismissed.";
    });
  }

  function pauseImportJob(job: ActionCenterEbayImportJob) {
    void runAction(`pause-import-job:${job.id}`, async () => {
      await postJson<{ job?: ActionCenterEbayImportJob }>(
        `/api/ebay-import/jobs/${job.id}/pause`
      );
      return job.status === "RUNNING"
        ? "eBay import will pause after the current listing."
        : "eBay import paused.";
    });
  }

  function resumeImportJob(job: ActionCenterEbayImportJob) {
    void runAction(`resume-import-job:${job.id}`, async () => {
      await postJson<{ job?: ActionCenterEbayImportJob }>(
        `/api/ebay-import/jobs/${job.id}/resume`
      );
      return "eBay import resumed.";
    });
  }

  function cancelImportJob(job: ActionCenterEbayImportJob) {
    if (!window.confirm("Cancel this eBay import after the current listing?")) {
      return;
    }

    void runAction(`cancel-import-job:${job.id}`, async () => {
      await postJson<{ job?: ActionCenterEbayImportJob }>(
        `/api/ebay-import/jobs/${job.id}/cancel`
      );
      return "eBay import cancellation requested.";
    });
  }

  function pauseResearchBatch(batch: ActionCenterEbayResearchBatch) {
    void runAction(`pause-research-batch:${batch.id}`, async () => {
      await postJson(`/api/ebay-research/batches/${batch.id}/pause`);
      return batch.running > 0
        ? "Research batch will pause after the current search."
        : "Research batch paused.";
    });
  }

  function resumeResearchBatch(batch: ActionCenterEbayResearchBatch) {
    void runAction(`resume-research-batch:${batch.id}`, async () => {
      await postJson(`/api/ebay-research/batches/${batch.id}/resume`);
      return "Research batch resumed.";
    });
  }

  function startAllProductsPriceCheck() {
    startPriceCheckJob(
      "start-all-products",
      { all: true },
      "No eligible tracked products found.",
      (total) => `Started all-products price check for ${total} product${total === 1 ? "" : "s"}.`
    );
  }

  function startVisibleFailedPriceCheck() {
    const productIds = data.queues.failedChecks.map((item) => item.product.id);

    startPriceCheckJob(
      "start-visible-failed",
      { productIds },
      "No visible failed checks to retry.",
      (total) => `Started failed-check retry job for ${total} product${total === 1 ? "" : "s"}.`
    );
  }

  function startVisibleLowStockPriceCheck() {
    const productIds = data.queues.lowStock.map((item) => item.product.id);

    startPriceCheckJob(
      "start-visible-low-stock",
      { productIds },
      "No visible low-stock products to check.",
      (total) => `Started low-stock price check for ${total} product${total === 1 ? "" : "s"}.`
    );
  }

  function syncAllPackageData() {
    void runAction("sync-package-data", async () => {
      const preview = await getJson<{
        listed: number;
        readyToApply: number;
        missingLocalPackageData: number;
      }>("/api/products/package-data");

      if (preview.listed === 0) {
        return "No listed products are available for package-data sync.";
      }

      if (
        !window.confirm(
          `Sync package weight and dimensions from eBay for ${preview.listed} listing(s)?\n\nThis only reads eBay and updates ListFlow. It does not change any eBay listings.`,
        )
      ) {
        return "Package-data sync cancelled.";
      }

      const result = await postJson<{ message?: string; job?: ActionCenterEbayActionJob }>(
        "/api/products/package-data/sync",
        { all: true },
      );
      setJobPanelFilter("current");
      return result.message ?? "Package-data sync queued.";
    });
  }

  function applyAllPackageData() {
    void runAction("apply-package-data", async () => {
      const preview = await getJson<{
        listed: number;
        readyToApply: number;
        missingLocalPackageData: number;
      }>("/api/products/package-data");

      if (preview.readyToApply === 0) {
        return "No imported listings have complete package data to send to eBay.";
      }

      if (
        !window.confirm(
          `Send package weight and dimensions to eBay for ${preview.readyToApply} listing(s)?\n\nThis updates only eBay package details and verifies each result after eBay accepts it.`,
        )
      ) {
        return "Package-data update cancelled.";
      }

      const result = await postJson<{ message?: string; job?: ActionCenterEbayActionJob }>(
        "/api/products/package-data/apply",
        { all: true },
      );
      setJobPanelFilter("current");
      return result.message ?? "Package-data update queued.";
    });
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Action Center</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review the listings, checks, stock alerts, and jobs that need attention.
          </p>
        </div>
        <div
          className={`min-w-64 rounded-md border px-3 py-2 text-sm ${
            data.worker.online
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="font-medium">
            {data.worker.online ? "Worker online" : "Worker offline"}
          </div>
          <div className="mt-0.5 text-xs">
            {data.workers.filter((worker) => worker.online).length}/
            {Math.max(data.workers.length, 1)} online
          </div>
          <div className="mt-2 space-y-1">
            {data.workers.length === 0 ? (
              <div className="text-xs">No worker has checked in yet.</div>
            ) : (
              data.workers.slice(0, 4).map((worker) => (
                <div
                  key={worker.workerId ?? worker.workerName ?? "worker"}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="font-medium">
                    {worker.workerName ?? worker.workerId ?? "Worker"}
                    <span className="ml-1 font-normal opacity-70">
                      ({worker.workerRole === "store-specific"
                        ? "Store-specific"
                        : worker.workerRole === "unified"
                          ? "Unified"
                          : "Legacy"})
                    </span>
                  </span>
                  <span>
                    {worker.online ? "Online" : "Stale"} ·{" "}
                    {formatWorkerLastSeen(worker.lastSeenAt)}
                    {worker.currentJobs.length > 0
                      ? ` · ${worker.currentJobs.length} job lease${
                          worker.currentJobs.length === 1 ? "" : "s"
                        }`
                      : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile Filter Tabs (< md) ── */}
      <div className="mb-4 md:hidden flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {FILTER_OPTIONS.map((option) => {
          const selected = activeFilter === option.id;
          const count = getFilterCount(adjustedSummary, data, option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setActiveFilter(option.id);
                setSelectedProductIds([]);
              }}
              aria-pressed={selected}
              className={`flex-shrink-0 flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors border ${
                selected
                  ? "border-primary bg-primary text-white shadow-xs"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[11px] font-semibold ${
                  selected ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Desktop Filter Grid (>= md) ── */}
      <div className="mb-6 hidden md:grid gap-3 md:grid-cols-5">
        {FILTER_OPTIONS.map((option) => {
          const selected = activeFilter === option.id;
          const count = getFilterCount(adjustedSummary, data, option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setActiveFilter(option.id);
                setSelectedProductIds([]);
              }}
              aria-pressed={selected}
              className={`rounded-md border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div
                className={`text-xs font-medium uppercase tracking-wide ${
                  selected ? "text-gray-300" : "text-gray-500"
                }`}
              >
                {option.label}
              </div>
              <div className="mt-1 text-2xl font-semibold">{count}</div>
              <div
                className={`mt-1 text-xs ${
                  selected ? "text-gray-300" : "text-gray-500"
                }`}
              >
                {option.helper}
              </div>
            </button>
          );
        })}
      </div>

      {runningAction && (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
          <ActionProgressBar
            label="Running action"
            percent={runningActionProgress}
            detail="ListFlow is sending the request and waiting for the result."
            tone="blue"
          />
        </div>
      )}

      <div className="space-y-6">
        {activeFilter === "pendingReviews" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <SectionHeader
              title="Needs Price Review"
              count={adjustedSummary.pendingReviews}
              selectedCount={selectedInActiveTab.length}
              onClearSelection={clearSelection}
              viewAllHref="/products?filter=needs-changing-price"
            >
              <ActionButton
                onClick={() =>
                  bulkReview(
                    "apply",
                    selectedInActiveTab.length > 0 ? selectedInActiveTab : undefined
                  )
                }
                disabled={
                  activeQueues.pendingReviews.length === 0 ||
                  runningAction === "bulk-apply"
                }
                tone="primary"
              >
                {runningAction === "bulk-apply"
                  ? "Applying..."
                  : selectedInActiveTab.length > 0
                    ? `Apply selected (${selectedInActiveTab.length})`
                    : "Apply visible"}
              </ActionButton>
              <ActionButton
                onClick={() =>
                  bulkReview(
                    "dismiss",
                    selectedInActiveTab.length > 0 ? selectedInActiveTab : undefined
                  )
                }
                disabled={
                  activeQueues.pendingReviews.length === 0 ||
                  runningAction === "bulk-dismiss"
                }
              >
                {runningAction === "bulk-dismiss"
                  ? "Dismissing..."
                  : selectedInActiveTab.length > 0
                    ? `Dismiss selected (${selectedInActiveTab.length})`
                    : "Dismiss visible"}
              </ActionButton>
            </SectionHeader>

            {/* ── Mobile Card List (< lg) ── */}
            <div className="lg:hidden divide-y divide-gray-100 p-3 space-y-3">
              {activeQueues.pendingReviews.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-500">No pending price reviews.</div>
              ) : (
                activeQueues.pendingReviews.map((item) => {
                  const isSelected = selectedProductIds.includes(item.product.id);
                  return (
                    <div
                      key={item.product.id}
                      className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                        isSelected ? "border-orange-300 bg-orange-50/50" : "border-gray-200 bg-white shadow-2xs"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.product.title}`}
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(item.product.id)}
                          className="mt-0.5 h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm text-gray-900 leading-snug">{item.product.title}</div>
                          {item.pendingCount > 1 && (
                            <div className="mt-0.5 text-xs text-amber-700 font-medium">
                              {item.pendingCount} pending variant changes
                            </div>
                          )}
                          <div className="mt-1">
                            <ProductLinks product={item.product} />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-2.5 text-xs">
                        <div>
                          <span className="text-gray-500 block">Buy Price:</span>
                          <span className="font-medium">{formatMoney(item.previousPrice)} → {formatMoney(item.newPrice)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Sell Price:</span>
                          <span className="font-medium">{formatMoney(item.previousSellPrice)} → {formatMoney(item.newSellPrice)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Change:</span>
                          <span className={`font-semibold ${Number(item.changeAmount) > 0 ? "text-red-700" : Number(item.changeAmount) < 0 ? "text-emerald-700" : "text-gray-700"}`}>
                            {formatSignedMoney(item.changeAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Profit:</span>
                          <span className={`font-semibold ${item.profit === null ? "text-gray-500" : Number(item.profit) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                            {formatMoney(item.profit)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <ActionButton
                          onClick={() => applyReview(item)}
                          disabled={runningAction === `apply:${item.product.id}`}
                          tone="primary"
                          className="flex-1 justify-center py-2"
                        >
                          {runningAction === `apply:${item.product.id}` ? "Applying..." : "Apply"}
                        </ActionButton>
                        <ActionButton
                          onClick={() => dismissReview(item)}
                          disabled={runningAction === `dismiss:${item.product.id}`}
                          className="flex-1 justify-center py-2"
                        >
                          {runningAction === `dismiss:${item.product.id}` ? "Dismissing..." : "Dismiss"}
                        </ActionButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Desktop Table (>= lg) ── */}
            <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all pending reviews"
                      checked={isAllSelected}
                      ref={(input) => {
                        if (input) {
                          input.indeterminate = isSomeSelected;
                        }
                      }}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Buy Price</th>
                  <th className="px-4 py-3">Sell Price</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">Profit</th>
                  <th className="px-4 py-3">Detected</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeQueues.pendingReviews.length === 0 ? (
                  <EmptyRow colSpan={8} message="No pending price reviews." />
                ) : (
                  activeQueues.pendingReviews.map((item) => {
                    const isSelected = selectedProductIds.includes(item.product.id);
                    return (
                      <tr
                        key={item.product.id}
                        className={`transition-colors duration-150 ${isSelected ? "bg-orange-50/40" : ""}`}
                      >
                        <td className="w-10 px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.product.title}`}
                            checked={isSelected}
                            onChange={() => toggleSelectProduct(item.product.id)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-gray-900">{item.product.title}</div>
                          {item.pendingCount > 1 && (
                            <div className="mt-1 text-xs text-amber-700">
                              {item.pendingCount} pending variant changes
                            </div>
                          )}
                          <ProductLinks product={item.product} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {formatMoney(item.previousPrice)} {"->"} {formatMoney(item.newPrice)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {formatMoney(item.previousSellPrice)} {"->"}{" "}
                          {formatMoney(item.newSellPrice)}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm font-medium ${
                            Number(item.changeAmount) > 0
                              ? "text-red-700"
                              : Number(item.changeAmount) < 0
                                ? "text-emerald-700"
                                : "text-gray-700"
                          }`}
                        >
                          {formatSignedMoney(item.changeAmount)}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm font-medium ${
                            item.profit === null
                              ? "text-gray-500"
                              : Number(item.profit) < 0
                                ? "text-red-700"
                                : "text-emerald-700"
                          }`}
                        >
                          {formatMoney(item.profit)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {formatDateTime(item.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <ActionButton
                              onClick={() => applyReview(item)}
                              disabled={runningAction === `apply:${item.product.id}`}
                              tone="primary"
                            >
                              {runningAction === `apply:${item.product.id}` ? "Applying..." : "Apply"}
                            </ActionButton>
                            <ActionButton
                              onClick={() => dismissReview(item)}
                              disabled={runningAction === `dismiss:${item.product.id}`}
                            >
                              {runningAction === `dismiss:${item.product.id}`
                                ? "Dismissing..."
                                : "Dismiss"}
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {activeFilter === "failedChecks" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="Failed Price Checks"
            count={adjustedSummary.failedChecks}
            selectedCount={selectedInActiveTab.length}
            onClearSelection={clearSelection}
            viewAllHref="/products?filter=failed-on-hold"
          >
            <ActionButton
              onClick={() =>
                bulkRetryFailedChecks(
                  selectedInActiveTab.length > 0 ? selectedInActiveTab : undefined
                )
              }
              disabled={
                activeQueues.failedChecks.length === 0 ||
                runningAction === "bulk-retry"
              }
              tone="primary"
            >
              {runningAction === "bulk-retry"
                ? "Starting..."
                : selectedInActiveTab.length > 0
                  ? `Retry selected (${selectedInActiveTab.length})`
                  : `Retry all (${activeQueues.failedChecks.length})`}
            </ActionButton>
            {selectedInActiveTab.length > 0 && (
              <>
                <ActionButton
                  onClick={() => bulkHoldProducts(selectedInActiveTab)}
                  disabled={runningAction === "bulk-hold"}
                >
                  {runningAction === "bulk-hold"
                    ? "Holding..."
                    : `Hold selected (${selectedInActiveTab.length})`}
                </ActionButton>
                <ActionButton
                  onClick={() => bulkEndProducts(selectedInActiveTab)}
                  disabled={runningAction === "bulk-end"}
                  tone="danger"
                >
                  {runningAction === "bulk-end"
                    ? "Ending..."
                    : `End selected (${selectedInActiveTab.length})`}
                </ActionButton>
              </>
            )}
          </SectionHeader>

          {/* ── Mobile Card List (< lg) ── */}
          <div className="lg:hidden divide-y divide-gray-100 p-3 space-y-3">
            {activeQueues.failedChecks.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">No failed price checks.</div>
            ) : (
              activeQueues.failedChecks.map((item: FailedCheckActionItem) => {
                const isSelected = selectedProductIds.includes(item.product.id);
                return (
                  <div
                    key={item.product.id}
                    className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                      isSelected ? "border-orange-300 bg-orange-50/50" : "border-gray-200 bg-white shadow-2xs"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.product.title}`}
                        checked={isSelected}
                        onChange={() => toggleSelectProduct(item.product.id)}
                        className="mt-0.5 h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-gray-900 leading-snug">{item.product.title}</div>
                        <div className="mt-1">
                          <ProductLinks product={item.product} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                      <span className="font-semibold block mb-0.5">Error:</span>
                      {item.errorMessage}
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Last checked:</span>
                      <span>{formatDateTime(item.lastPriceCheck)}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <ActionButton
                        onClick={() => retryCheck(item.product)}
                        disabled={runningAction === `retry:${item.product.id}`}
                        tone="primary"
                        className="flex-1 justify-center py-2"
                      >
                        {runningAction === `retry:${item.product.id}` ? "Starting..." : "Retry"}
                      </ActionButton>
                      <ActionButton
                        onClick={() => holdProduct(item.product)}
                        disabled={runningAction === `hold:${item.product.id}`}
                        className="flex-1 justify-center py-2"
                      >
                        Hold
                      </ActionButton>
                      <ActionButton
                        onClick={() => endProduct(item.product)}
                        disabled={runningAction === `end:${item.product.id}`}
                        tone="danger"
                        className="py-2"
                      >
                        End
                      </ActionButton>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Desktop Table (>= lg) ── */}
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all failed checks"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = isSomeSelected;
                      }
                    }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Last Check</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeQueues.failedChecks.length === 0 ? (
                <EmptyRow colSpan={5} message="No failed price checks." />
              ) : (
                activeQueues.failedChecks.map((item: FailedCheckActionItem) => {
                  const isSelected = selectedProductIds.includes(item.product.id);
                  return (
                    <tr
                      key={item.product.id}
                      className={`transition-colors duration-150 ${isSelected ? "bg-orange-50/40" : ""}`}
                    >
                      <td className="w-10 px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.product.title}`}
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(item.product.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{item.product.title}</div>
                        <ProductLinks product={item.product} />
                      </td>
                      <td className="max-w-lg px-4 py-3 text-sm text-red-700">
                        <div className="line-clamp-2" title={item.errorMessage}>
                          {item.errorMessage}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDateTime(item.lastPriceCheck)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            onClick={() => retryCheck(item.product)}
                            disabled={runningAction === `retry:${item.product.id}`}
                            tone="primary"
                          >
                            {runningAction === `retry:${item.product.id}` ? "Starting..." : "Retry"}
                          </ActionButton>
                          <ActionButton
                            onClick={() => holdProduct(item.product)}
                            disabled={runningAction === `hold:${item.product.id}`}
                          >
                            Hold
                          </ActionButton>
                          <ActionButton
                            onClick={() => endProduct(item.product)}
                            disabled={runningAction === `end:${item.product.id}`}
                            tone="danger"
                          >
                            End
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </section>
        )}

        {activeFilter === "lowStock" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="Low Amazon Stock"
            count={adjustedSummary.lowStock}
            selectedCount={selectedInActiveTab.length}
            onClearSelection={clearSelection}
            viewAllHref="/products?stockMonitoring=low-stock"
          >
            {selectedInActiveTab.length > 0 ? (
              <ActionButton
                onClick={() => bulkHoldProducts(selectedInActiveTab)}
                disabled={workerOffline || runningAction === "bulk-hold"}
                tone="primary"
              >
                {runningAction === "bulk-hold"
                  ? "Holding..."
                  : `Hold selected (${selectedInActiveTab.length})`}
              </ActionButton>
            ) : (
              <ActionButton
                onClick={holdAllLowStockProducts}
                disabled={
                  workerOffline ||
                  hasActiveLowStockHoldJob ||
                  adjustedSummary.lowStock === 0 ||
                  runningAction === "hold-all-low-stock"
                }
                tone="primary"
              >
                {runningAction === "hold-all-low-stock"
                  ? "Queueing..."
                  : hasActiveLowStockHoldJob
                    ? "Hold queued"
                  : `Hold all (${adjustedSummary.lowStock})`}
              </ActionButton>
            )}
          </SectionHeader>

          {/* ── Mobile Card List (< lg) ── */}
          <div className="lg:hidden divide-y divide-gray-100 p-3 space-y-3">
            {activeQueues.lowStock.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">No low-stock products.</div>
            ) : (
              activeQueues.lowStock.map((item: LowStockActionItem) => {
                const isSelected = selectedProductIds.includes(item.product.id);
                return (
                  <div
                    key={item.product.id}
                    className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                      isSelected ? "border-orange-300 bg-orange-50/50" : "border-gray-200 bg-white shadow-2xs"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.product.title}`}
                        checked={isSelected}
                        onChange={() => toggleSelectProduct(item.product.id)}
                        className="mt-0.5 h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-gray-900 leading-snug">{item.product.title}</div>
                        <div className="mt-1">
                          <ProductLinks product={item.product} />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-amber-50 rounded-lg p-2.5">
                      <span className="text-xs text-amber-900 font-medium">Amazon Stock:</span>
                      <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                        {item.amazonStockLeft ?? "?"} left
                      </span>
                    </div>

                    <div className="pt-1">
                      <ActionButton
                        onClick={() => holdProduct(item.product)}
                        disabled={runningAction === `hold:${item.product.id}`}
                        tone="primary"
                        className="w-full justify-center py-2"
                      >
                        Hold product
                      </ActionButton>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Desktop Table (>= lg) ── */}
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all low stock items"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = isSomeSelected;
                      }
                    }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Stock Left</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeQueues.lowStock.length === 0 ? (
                <EmptyRow colSpan={4} message="No low-stock products." />
              ) : (
                activeQueues.lowStock.map((item: LowStockActionItem) => {
                  const isSelected = selectedProductIds.includes(item.product.id);
                  return (
                    <tr
                      key={item.product.id}
                      className={`transition-colors duration-150 ${isSelected ? "bg-orange-50/40" : ""}`}
                    >
                      <td className="w-10 px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.product.title}`}
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(item.product.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{item.product.title}</div>
                        <ProductLinks product={item.product} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                          {item.amazonStockLeft ?? "?"} left
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            onClick={() => holdProduct(item.product)}
                            disabled={runningAction === `hold:${item.product.id}`}
                            tone="primary"
                          >
                            Hold
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </section>
        )}

        {activeFilter === "onHold" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="On Hold"
            count={adjustedSummary.onHold}
            selectedCount={selectedInActiveTab.length}
            onClearSelection={clearSelection}
            viewAllHref="/products?filter=failed-on-hold"
          >
            <ActionButton
              onClick={() =>
                bulkResumeProducts(
                  selectedInActiveTab.length > 0 ? selectedInActiveTab : undefined
                )
              }
              disabled={
                activeQueues.onHold.length === 0 ||
                runningAction === "bulk-resume"
              }
              tone="primary"
            >
              {runningAction === "bulk-resume"
                ? "Resuming..."
                : selectedInActiveTab.length > 0
                  ? `Resume selected (${selectedInActiveTab.length})`
                  : `Resume visible (${activeQueues.onHold.length})`}
            </ActionButton>
            <ActionButton
              onClick={() =>
                bulkEndProducts(
                  selectedInActiveTab.length > 0 ? selectedInActiveTab : undefined
                )
              }
              disabled={
                activeQueues.onHold.length === 0 ||
                runningAction === "bulk-end"
              }
              tone="danger"
            >
              {runningAction === "bulk-end"
                ? "Ending..."
                : selectedInActiveTab.length > 0
                  ? `End selected (${selectedInActiveTab.length})`
                  : `End visible (${activeQueues.onHold.length})`}
            </ActionButton>
          </SectionHeader>

          {/* ── Mobile Card List (< lg) ── */}
          <div className="lg:hidden divide-y divide-gray-100 p-3 space-y-3">
            {activeQueues.onHold.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">No on-hold products.</div>
            ) : (
              activeQueues.onHold.map((item: OnHoldActionItem) => {
                const isSelected = selectedProductIds.includes(item.product.id);
                return (
                  <div
                    key={item.product.id}
                    className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                      isSelected ? "border-orange-300 bg-orange-50/50" : "border-gray-200 bg-white shadow-2xs"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.product.title}`}
                        checked={isSelected}
                        onChange={() => toggleSelectProduct(item.product.id)}
                        className="mt-0.5 h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-gray-900 leading-snug">{item.product.title}</div>
                        <div className="mt-1">
                          <ProductLinks product={item.product} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-700 space-y-1">
                      <div>
                        <span className="font-semibold text-gray-500 block">Reason:</span>
                        <span className="font-medium text-gray-800">{item.reason}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
                        <span className="text-gray-500">Quantity:</span>
                        <span className="font-semibold">{item.quantity}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <ActionButton
                        onClick={() => resumeProduct(item.product)}
                        disabled={runningAction === `resume:${item.product.id}`}
                        tone="primary"
                        className="flex-1 justify-center py-2"
                      >
                        Resume
                      </ActionButton>
                      <ActionButton
                        onClick={() => endProduct(item.product)}
                        disabled={runningAction === `end:${item.product.id}`}
                        tone="danger"
                        className="flex-1 justify-center py-2"
                      >
                        End
                      </ActionButton>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Desktop Table (>= lg) ── */}
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all on hold products"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = isSomeSelected;
                      }
                    }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeQueues.onHold.length === 0 ? (
                <EmptyRow colSpan={5} message="No on-hold products." />
              ) : (
                activeQueues.onHold.map((item: OnHoldActionItem) => {
                  const isSelected = selectedProductIds.includes(item.product.id);
                  return (
                    <tr
                      key={item.product.id}
                      className={`transition-colors duration-150 ${isSelected ? "bg-orange-50/40" : ""}`}
                    >
                      <td className="w-10 px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.product.title}`}
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(item.product.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{item.product.title}</div>
                        <ProductLinks product={item.product} />
                      </td>
                      <td className="max-w-xl px-4 py-3 align-top text-sm text-gray-700">
                        <div className="line-clamp-3" title={item.reason}>
                          {item.reason}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{item.quantity}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            onClick={() => resumeProduct(item.product)}
                            disabled={runningAction === `resume:${item.product.id}`}
                            tone="primary"
                          >
                            Resume
                          </ActionButton>
                          <ActionButton
                            onClick={() => endProduct(item.product)}
                            disabled={runningAction === `end:${item.product.id}`}
                            tone="danger"
                          >
                            End
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </section>
        )}


        {activeFilter === "jobs" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <SectionHeader
              title="Jobs"
              count={getCurrentJobCount(data)}
            />
            <div className="border-b border-gray-200 px-3 sm:px-4 py-2.5 sm:py-3 overflow-x-auto no-scrollbar">
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white whitespace-nowrap">
                {JOB_PANEL_FILTERS.map((option) => {
                  const selected = jobPanelFilter === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setJobPanelFilter(option.id)}
                      aria-pressed={selected}
                      className={`border-r border-gray-300 px-3 py-1.5 text-xs font-medium transition-colors last:border-r-0 ${
                        selected
                          ? "bg-gray-900 text-white"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {jobPanelFilter === "current" && (
              <div className="divide-y divide-gray-100">
                {currentPriceJobs.length === 0 &&
                activeImportJobs.length === 0 &&
                currentResearchBatches.length === 0 &&
                currentActionJobs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">
                    No current or paused jobs.
                  </div>
                ) : (
                  <>
                    {currentPriceJobs.map((job) => (
                      <div
                        key={`current-price-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              Product price check
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                job.trigger === "AUTOMATIC"
                                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                                  : "bg-slate-50 text-slate-700 border border-slate-200"
                              }`}
                            >
                              {job.trigger === "AUTOMATIC" ? "Automatic" : "Manual"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status === "CANCELLED" ? "PAUSED" : job.status}
                            </span>
                            <JobWorkerAssignment
                              assignment={getActiveJobAssignment(
                                activeJobAssignments,
                                "PRICE_CHECK",
                                job.id,
                              )}
                              status={job.status}
                            />
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.checked}/{job.total} checked, {job.pendingReview} pending,{" "}
                            {job.failed} failed
                            {job.autoHoldQueued > 0
                              ? `, ${job.autoHoldQueued} auto-hold queued`
                              : ""}
                            {isResumablePriceJob(job) ? `, ${job.remaining} remaining` : ""}
                          </div>
                          <div className="mt-2 max-w-sm">
                            <ActionProgressBar
                              label="Price check progress"
                              percent={
                                job.total > 0
                                  ? Math.min(100, Math.round((job.checked / job.total) * 100))
                                  : 0
                              }
                              tone={job.status === "CANCELLING" ? "amber" : "blue"}
                              compact
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isActivePriceJob(job) && (
                            <>
                              <ActionButton
                                onClick={() => cancelPriceJob(job, false)}
                                disabled={runningAction === `stop-job:${job.id}`}
                                tone="danger"
                              >
                                {runningAction === `stop-job:${job.id}`
                                  ? "Stopping..."
                                  : job.status === "CANCELLING"
                                    ? "Stopping..."
                                    : "Pause"}
                              </ActionButton>
                              <ActionButton
                                onClick={() => cancelPriceJob(job, true)}
                                disabled={runningAction === `stop-job:${job.id}`}
                                tone="danger"
                              >
                                Force Stop
                              </ActionButton>
                            </>
                          )}
                          {isResumablePriceJob(job) && (
                            <>
                              <ActionButton
                                onClick={() => resumePriceJob(job)}
                                disabled={
                                  workerOffline || runningAction === `resume-job:${job.id}`
                                }
                                tone="primary"
                              >
                                {runningAction === `resume-job:${job.id}`
                                  ? "Resuming..."
                                  : "Resume"}
                              </ActionButton>
                              <ActionButton
                                onClick={() => dismissPriceJob(job)}
                                disabled={runningAction === `dismiss-price-job:${job.id}`}
                              >
                                {runningAction === `dismiss-price-job:${job.id}`
                                  ? "Dismissing..."
                                  : "Dismiss"}
                              </ActionButton>
                            </>
                          )}
                          <Link
                            href="/products"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            Products
                          </Link>
                        </div>
                      </div>
                    ))}
                    {activeImportJobs.map((job) => (
                      <div
                        key={`current-import-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              eBay import - {job.storeName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                            <JobWorkerAssignment
                              assignment={getActiveJobAssignment(
                                activeJobAssignments,
                                "EBAY_IMPORT",
                                job.id,
                              )}
                              status={job.status}
                            />
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.processed}/{job.total || job.quantity} processed,{" "}
                            {job.created} imported, {job.failed} failed
                          </div>
                          <div className="mt-2 max-w-sm">
                            <ActionProgressBar
                              label="Import progress"
                              percent={job.progressPercent}
                              tone={
                                job.status === "PAUSED" || job.status === "PAUSING"
                                  ? "amber"
                                  : job.status === "CANCELLING"
                                    ? "red"
                                    : "orange"
                              }
                              compact
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {job.canPause && (
                            <ActionButton
                              onClick={() => pauseImportJob(job)}
                              disabled={runningAction === `pause-import-job:${job.id}`}
                              tone="danger"
                            >
                              {runningAction === `pause-import-job:${job.id}`
                                ? "Pausing..."
                                : "Pause"}
                            </ActionButton>
                          )}
                          {job.canResume && (
                            <>
                              <ActionButton
                                onClick={() => resumeImportJob(job)}
                                disabled={
                                  workerOffline ||
                                  runningAction === `resume-import-job:${job.id}`
                                }
                                tone="primary"
                              >
                                {runningAction === `resume-import-job:${job.id}`
                                  ? "Resuming..."
                                  : "Resume"}
                              </ActionButton>
                              <ActionButton
                                onClick={() => dismissImportJob(job)}
                                disabled={runningAction === `dismiss-import-job:${job.id}`}
                              >
                                {runningAction === `dismiss-import-job:${job.id}`
                                  ? "Dismissing..."
                                  : "Dismiss"}
                              </ActionButton>
                            </>
                          )}
                          {job.canCancel && (
                            <ActionButton
                              onClick={() => cancelImportJob(job)}
                              disabled={runningAction === `cancel-import-job:${job.id}`}
                              tone="danger"
                            >
                              {runningAction === `cancel-import-job:${job.id}`
                                ? "Cancelling..."
                                : "Cancel"}
                            </ActionButton>
                          )}
                          <Link
                            href="/ebay-import"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            eBay Import
                          </Link>
                        </div>
                      </div>
                    ))}
                    {currentActionJobs.map((job) => (
                      <div
                        key={`current-action-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {actionJobLabel(job)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {actionJobProgressLabel(job)}
                            </span>
                            <JobWorkerAssignment
                              assignment={getActiveJobAssignment(
                                activeJobAssignments,
                                "EBAY_ACTION",
                                job.id,
                              )}
                              status={job.status}
                            />
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {actionJobDetail(job)}
                          </div>
                          <div className="mt-2 max-w-sm">
                            <ActionProgressBar
                              label={actionJobProgressLabel(job)}
                              percent={
                                job.total > 0
                                  ? Math.min(100, Math.round((job.processed / job.total) * 100))
                                  : 0
                              }
                              tone="blue"
                              compact
                            />
                          </div>
                        </div>
                        <Link
                          href="/products"
                          className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          Products
                        </Link>
                      </div>
                    ))}
                    {currentResearchBatches.map((batch) => (
                      <div
                        key={`current-research-${batch.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              eBay research batch
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(batch.status)}`}
                            >
                              {batch.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {batch.completed}/{batch.total} complete, {batch.failed} failed,{" "}
                            {batch.running} running, {batch.queued} queued, {batch.paused} paused
                            {batch.cooldownUntil
                              ? `, next after ${formatDateTime(batch.cooldownUntil)}`
                              : ""}
                            {batch.completedAt && formatDuration(batch.startedAt, batch.completedAt)
                              ? ` - took ${formatDuration(batch.startedAt, batch.completedAt)}`
                              : ""}
                          </div>
                          <ResearchBatchWorkerAssignments
                            batch={batch}
                            assignments={activeJobAssignments}
                          />
                          <div className="mt-2 max-w-sm">
                            <ActionProgressBar
                              label="Research batch progress"
                              percent={
                                batch.total > 0
                                  ? Math.min(
                                      100,
                                      Math.round(
                                        ((batch.completed + batch.failed) / batch.total) * 100,
                                      ),
                                    )
                                  : 0
                              }
                              tone={
                                batch.status === "PAUSED" || batch.status === "PAUSING"
                                  ? "amber"
                                  : "blue"
                              }
                              compact
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {batch.canPause && (
                            <ActionButton
                              onClick={() => pauseResearchBatch(batch)}
                              disabled={
                                runningAction === `pause-research-batch:${batch.id}`
                              }
                              tone="danger"
                            >
                              {runningAction === `pause-research-batch:${batch.id}`
                                ? "Pausing..."
                                : "Pause"}
                            </ActionButton>
                          )}
                          {batch.canResume && (
                            <ActionButton
                              onClick={() => resumeResearchBatch(batch)}
                              disabled={
                                workerOffline ||
                                runningAction === `resume-research-batch:${batch.id}`
                              }
                              tone="primary"
                            >
                              {runningAction === `resume-research-batch:${batch.id}`
                                ? "Resuming..."
                                : "Resume"}
                            </ActionButton>
                          )}
                          <Link
                            href="/ebay-research"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            eBay Research
                          </Link>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {jobPanelFilter === "start" && (
              <div className="divide-y divide-gray-100">
                {workerOffline && (
                  <div className="bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {workerMessage}
                  </div>
                )}
                {hasActivePriceJobs && (
                  <div className="bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    A price check is in progress. New checks are accepted and added to the queue.
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Check all imported products
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Starts a full Products page price-check job.
                    </div>
                  </div>
                  <ActionButton
                    onClick={startAllProductsPriceCheck}
                    disabled={
                      workerOffline ||
                      runningAction === "start-all-products"
                    }
                    tone="primary"
                  >
                    {runningAction === "start-all-products" ? "Starting..." : "Start all"}
                  </ActionButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Retry visible failed checks
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {activeQueues.failedChecks.length} visible failed product
                      {activeQueues.failedChecks.length === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <ActionButton
                    onClick={startVisibleFailedPriceCheck}
                    disabled={
                      workerOffline ||
                      activeQueues.failedChecks.length === 0 ||
                      runningAction === "start-visible-failed"
                    }
                    tone="primary"
                  >
                    {runningAction === "start-visible-failed" ? "Starting..." : "Retry failed"}
                  </ActionButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Check visible low-stock products
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {activeQueues.lowStock.length} visible low-stock product
                      {activeQueues.lowStock.length === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <ActionButton
                    onClick={startVisibleLowStockPriceCheck}
                    disabled={
                      workerOffline ||
                      activeQueues.lowStock.length === 0 ||
                      runningAction === "start-visible-low-stock"
                    }
                    tone="primary"
                  >
                    {runningAction === "start-visible-low-stock"
                      ? "Starting..."
                      : "Check low stock"}
                  </ActionButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Sync eBay package data
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Read existing package weight and dimensions from eBay into ListFlow. No eBay listings are changed.
                    </div>
                  </div>
                  <ActionButton
                    onClick={syncAllPackageData}
                    disabled={workerOffline || runningAction === "sync-package-data"}
                  >
                    {runningAction === "sync-package-data" ? "Starting..." : "Sync package data"}
                  </ActionButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Apply package data to eBay
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Send complete ListFlow package fields to eBay and confirm the saved result.
                    </div>
                  </div>
                  <ActionButton
                    onClick={applyAllPackageData}
                    disabled={workerOffline || runningAction === "apply-package-data"}
                    tone="primary"
                  >
                    {runningAction === "apply-package-data" ? "Starting..." : "Apply to eBay"}
                  </ActionButton>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Batch Safe eBay research
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Queue up to 50 product names. Runs 5 API searches, waits 2 minutes, then continues.
                    </div>
                  </div>
                  <Link
                    href="/ebay-research"
                    className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Open eBay Research
                  </Link>
                </div>
              </div>
            )}

            {jobPanelFilter === "recent" && (
              <div className="divide-y divide-gray-100">
                {recentPriceJobs.length === 0 &&
                recentImportJobs.length === 0 &&
                recentResearchBatches.length === 0 &&
                recentActionJobs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">
                    No recent jobs.
                  </div>
                ) : (
                  <>
                    {recentPriceJobs.map((job) => (
                      <div
                        key={`recent-price-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              Product price check
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                job.trigger === "AUTOMATIC"
                                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                                  : "bg-slate-50 text-slate-700 border border-slate-200"
                              }`}
                            >
                              {job.trigger === "AUTOMATIC" ? "Automatic" : "Manual"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.checked}/{job.total} checked, {job.pendingReview} pending,{" "}
                            {job.failed} failed
                            {job.autoHoldQueued > 0
                              ? `, ${job.autoHoldQueued} auto-hold queued`
                              : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isTerminalPriceJob(job) && (
                            <ActionButton
                              onClick={() => dismissPriceJob(job)}
                              disabled={runningAction === `dismiss-price-job:${job.id}`}
                            >
                              {runningAction === `dismiss-price-job:${job.id}`
                                ? "Dismissing..."
                                : "Dismiss"}
                            </ActionButton>
                          )}
                          <Link
                            href="/products"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            Products
                          </Link>
                        </div>
                      </div>
                    ))}
                    {recentImportJobs.map((job) => (
                      <div
                        key={`recent-import-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              eBay import - {job.storeName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.processed}/{job.total || job.quantity} processed,{" "}
                            {job.created} imported, {job.failed} failed
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isTerminalImportJob(job) && (
                            <ActionButton
                              onClick={() => dismissImportJob(job)}
                              disabled={runningAction === `dismiss-import-job:${job.id}`}
                            >
                              {runningAction === `dismiss-import-job:${job.id}`
                                ? "Dismissing..."
                                : "Dismiss"}
                            </ActionButton>
                          )}
                          <Link
                            href="/ebay-import"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            eBay Import
                          </Link>
                        </div>
                      </div>
                    ))}
                    {recentActionJobs.map((job) => (
                      <div
                        key={`recent-action-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {actionJobLabel(job)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {actionJobProgressLabel(job)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {actionJobDetail(job)}
                          </div>
                        </div>
                        <Link
                          href="/products"
                          className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          Products
                        </Link>
                      </div>
                    ))}
                    {recentResearchBatches.map((batch) => (
                      <div
                        key={`recent-research-${batch.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              eBay research batch
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(batch.status)}`}
                            >
                              {batch.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {batch.completed}/{batch.total} complete, {batch.failed} failed,{" "}
                            created {formatDateTime(batch.createdAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {batch.canPause && (
                            <ActionButton
                              onClick={() => pauseResearchBatch(batch)}
                              disabled={
                                runningAction === `pause-research-batch:${batch.id}`
                              }
                              tone="danger"
                            >
                              Pause
                            </ActionButton>
                          )}
                          {batch.canResume && (
                            <ActionButton
                              onClick={() => resumeResearchBatch(batch)}
                              disabled={
                                workerOffline ||
                                runningAction === `resume-research-batch:${batch.id}`
                              }
                              tone="primary"
                            >
                              Resume
                            </ActionButton>
                          )}
                          <Link
                            href="/ebay-research"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                          >
                            eBay Research
                          </Link>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {jobPanelFilter === "dismissed" && (
              <div className="divide-y divide-gray-100">
                {dismissedPriceJobs.length === 0 && dismissedImportJobs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-500">
                    No dismissed jobs.
                  </div>
                ) : (
                  <>
                    {dismissedPriceJobs.map((job) => (
                      <div
                        key={`dismissed-price-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              Product price check
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Dismissed {formatDateTime(job.dismissedAt)} - {job.checked}/{job.total} checked,{" "}
                            {job.pendingReview} pending, {job.failed} failed
                            {job.autoHoldQueued > 0
                              ? `, ${job.autoHoldQueued} auto-hold queued`
                              : ""}
                          </div>
                        </div>
                        <Link
                          href="/products"
                          className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          Products
                        </Link>
                      </div>
                    ))}
                    {dismissedImportJobs.map((job) => (
                      <div
                        key={`dismissed-import-${job.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              eBay import - {job.storeName}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Dismissed {formatDateTime(job.dismissedAt)} - {job.processed}/{job.total || job.quantity} processed,{" "}
                            {job.created} imported, {job.failed} failed
                          </div>
                        </div>
                        <Link
                          href="/ebay-import"
                          className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                          eBay Import
                        </Link>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {toast.visible && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onClose={hideToast}
        />
      )}
    </>
  );
}
