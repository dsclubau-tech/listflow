"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ActionProgressBar from "@/components/ActionProgressBar";
import AsinLink from "@/components/AsinLink";
import Toast from "@/components/Toast";
import { useTimedActionProgress } from "@/hooks/useTimedActionProgress";
import { useToast } from "@/hooks/useToast";
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `A$${parsed.toFixed(2)}` : "-";
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

function actionJobLabel(type: string) {
  if (type === "HOLD") return "Put listings on hold";
  if (type === "RESUME") return "Resume listings";
  if (type === "END") return "End listings";
  if (type === "BULK_EDIT_REVISE") return "Bulk edit listings";
  return "eBay listing action";
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
}) {
  const classes =
    tone === "primary"
      ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
      : tone === "danger"
        ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
    >
      {children}
    </button>
  );
}

function SectionHeader({
  title,
  count,
  viewAllHref,
  children,
}: {
  title: string;
  count: number;
  viewAllHref: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {count}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Link href={viewAllHref} className="text-xs font-medium text-gray-600 hover:text-gray-900">
          View all
        </Link>
      </div>
    </div>
  );
}

function getFilterCount(data: ActionCenterData, filter: ActionCenterFilter) {
  if (filter === "pendingReviews") {
    return data.summary.pendingReviews;
  }

  if (filter === "failedChecks") {
    return data.summary.failedChecks;
  }

  if (filter === "lowStock") {
    return data.summary.lowStock;
  }

  if (filter === "onHold") {
    return data.summary.onHold;
  }

  return getCurrentJobCount(data);
}

function hasFilterContent(data: ActionCenterData, filter: ActionCenterFilter) {
  if (filter === "pendingReviews") {
    return data.queues.pendingReviews.length > 0;
  }

  if (filter === "failedChecks") {
    return data.queues.failedChecks.length > 0;
  }

  if (filter === "lowStock") {
    return data.queues.lowStock.length > 0;
  }

  if (filter === "onHold") {
    return data.queues.onHold.length > 0;
  }

  return (
    data.jobs.priceChecks.length > 0 ||
    data.jobs.ebayImports.length > 0 ||
    data.jobs.ebayResearchBatches.length > 0 ||
    data.jobs.ebayActions.length > 0
  );
}

function getDefaultFilter(data: ActionCenterData): ActionCenterFilter {
  return (
    FILTER_OPTIONS.find((option) => hasFilterContent(data, option.id))?.id ??
    "pendingReviews"
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
  const [activeFilter, setActiveFilter] = useState<ActionCenterFilter>(() =>
    getDefaultFilter(data)
  );
  const [jobPanelFilter, setJobPanelFilter] =
    useState<JobPanelFilter>("current");
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
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hasActiveJobs, router]);

  useEffect(() => {
    if (hasFilterContent(data, activeFilter)) {
      return;
    }

    setActiveFilter(getDefaultFilter(data));
  }, [activeFilter, data]);

  async function runAction(
    key: string,
    task: () => Promise<string>,
    variant: ToastVariant = "success"
  ) {
    setRunningAction(key);

    try {
      const message = await task();
      showToast(message, variant);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed.";
      showToast(message, "error");
    } finally {
      setRunningAction(null);
    }
  }

  function applyReview(item: PendingReviewActionItem) {
    void runAction(`apply:${item.product.id}`, async () => {
      await postJson("/api/price-check/apply", { productId: item.product.id });
      return "Applied pending price change.";
    });
  }

  function dismissReview(item: PendingReviewActionItem) {
    void runAction(`dismiss:${item.product.id}`, async () => {
      await postJson("/api/price-check/dismiss", { productId: item.product.id });
      return "Dismissed pending price change.";
    });
  }

  function bulkReview(action: "apply" | "dismiss") {
    const productIds = data.queues.pendingReviews.map((item) => item.product.id);
    const endpoint =
      action === "apply" ? "/api/price-check/bulk-apply" : "/api/price-check/bulk-dismiss";

    void runAction(`bulk-${action}`, async () => {
      if (productIds.length === 0) {
        return "No visible pending reviews to update.";
      }

      const result = await postJson<{
        applied?: number;
        dismissed?: number;
        failed?: number;
      }>(endpoint, { productIds });

      if (action === "apply") {
        return `Applied ${result.applied ?? 0} visible price change(s). ${result.failed ?? 0} failed.`;
      }

      return `Dismissed ${result.dismissed ?? 0} visible price change(s).`;
    });
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
        return "A price check is already running.";
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

  function holdProduct(product: ActionCenterProductSummary) {
    void runAction(`hold:${product.id}`, async () => {
      const result = await postJson<{ held?: number; failed?: number; message?: string }>(
        "/api/products/bulk-hold",
        { productIds: [product.id] }
      );
      if (result.message) return result.message;
      return `Put ${result.held ?? 0} product(s) on hold. ${result.failed ?? 0} failed.`;
    });
  }

  function resumeProduct(product: ActionCenterProductSummary) {
    void runAction(`resume:${product.id}`, async () => {
      const result = await postJson<{ resumed?: number; failed?: number; message?: string }>(
        "/api/products/bulk-resume",
        { productIds: [product.id] }
      );
      if (result.message) return result.message;
      return `Resumed ${result.resumed ?? 0} product(s). ${result.failed ?? 0} failed.`;
    });
  }

  function endProduct(product: ActionCenterProductSummary) {
    const confirmed = window.confirm(
      `End this eBay listing and delete it from ListFlow?\n\n${product.title}`
    );

    if (!confirmed) {
      return;
    }

    void runAction(`end:${product.id}`, async () => {
      const result = await postJson<{ ended?: number; failed?: number; message?: string }>(
        "/api/products/bulk-end",
        { productIds: [product.id] }
      );
      if (result.message) return result.message;
      return `Ended ${result.ended ?? 0} listing(s). ${result.failed ?? 0} failed.`;
    });
  }

  function cancelPriceJob(job: ActionCenterPriceCheckJob) {
    void runAction(`stop-job:${job.id}`, async () => {
      await postJson(`/api/price-check/jobs/${job.id}/cancel`);
      return "Pausing price check after current product.";
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
        return "A price check is already running.";
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

      <div className="mb-6 grid gap-3 md:grid-cols-5">
        {FILTER_OPTIONS.map((option) => {
          const selected = activeFilter === option.id;
          const count = getFilterCount(data, option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setActiveFilter(option.id)}
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
              count={data.summary.pendingReviews}
              viewAllHref="/products?filter=needs-changing-price"
            >
              <ActionButton
                onClick={() => bulkReview("apply")}
                disabled={
                  data.queues.pendingReviews.length === 0 ||
                  runningAction === "bulk-apply"
                }
                tone="primary"
              >
                {runningAction === "bulk-apply" ? "Applying..." : "Apply visible"}
              </ActionButton>
              <ActionButton
                onClick={() => bulkReview("dismiss")}
                disabled={
                  data.queues.pendingReviews.length === 0 ||
                  runningAction === "bulk-dismiss"
                }
              >
                {runningAction === "bulk-dismiss" ? "Dismissing..." : "Dismiss visible"}
              </ActionButton>
            </SectionHeader>
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Buy Price</th>
                  <th className="px-4 py-3">Sell Price</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">Detected</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.queues.pendingReviews.length === 0 ? (
                  <EmptyRow colSpan={6} message="No pending price reviews." />
                ) : (
                  data.queues.pendingReviews.map((item) => (
                    <tr key={item.product.id}>
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
                          item.changePercent >= 0 ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {item.changePercent >= 0 ? "+" : ""}
                        {item.changePercent.toFixed(2)}%
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
                  ))
                )}
              </tbody>
            </table>
          </section>
        )}

        {activeFilter === "failedChecks" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="Failed Price Checks"
            count={data.summary.failedChecks}
            viewAllHref="/products?filter=failed-on-hold"
          />
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Last Check</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.queues.failedChecks.length === 0 ? (
                <EmptyRow colSpan={4} message="No failed price checks." />
              ) : (
                data.queues.failedChecks.map((item: FailedCheckActionItem) => (
                  <tr key={item.product.id}>
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
                ))
              )}
            </tbody>
          </table>
        </section>
        )}

        {activeFilter === "lowStock" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="Low Amazon Stock"
            count={data.summary.lowStock}
            viewAllHref="/products?stockMonitoring=low-stock"
          />
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Stock Left</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.queues.lowStock.length === 0 ? (
                <EmptyRow colSpan={3} message="No low-stock products." />
              ) : (
                data.queues.lowStock.map((item: LowStockActionItem) => (
                  <tr key={item.product.id}>
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
                ))
              )}
            </tbody>
          </table>
        </section>
        )}

        {activeFilter === "onHold" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <SectionHeader
            title="On Hold"
            count={data.summary.onHold}
            viewAllHref="/products?filter=failed-on-hold"
          />
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.queues.onHold.length === 0 ? (
                <EmptyRow colSpan={3} message="No on-hold products." />
              ) : (
                data.queues.onHold.map((item: OnHoldActionItem) => (
                  <tr key={item.product.id}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">{item.product.title}</div>
                      <ProductLinks product={item.product} />
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
                ))
              )}
            </tbody>
          </table>
        </section>
        )}

        {activeFilter === "jobs" && (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <SectionHeader
              title="Jobs"
              count={getCurrentJobCount(data)}
              viewAllHref="/price-tracker"
            />
            <div className="border-b border-gray-200 px-4 py-3">
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white">
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
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status === "CANCELLED" ? "PAUSED" : job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.checked}/{job.total} checked, {job.pendingReview} pending,{" "}
                            {job.failed} failed
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
                            <ActionButton
                              onClick={() => cancelPriceJob(job)}
                              disabled={
                                job.status === "CANCELLING" ||
                                runningAction === `stop-job:${job.id}`
                              }
                              tone="danger"
                            >
                              {job.status === "CANCELLING" ||
                              runningAction === `stop-job:${job.id}`
                                ? "Pausing..."
                                : "Pause"}
                            </ActionButton>
                          )}
                          {isResumablePriceJob(job) && (
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
                              {actionJobLabel(job.type)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.processed}/{job.total} processed, {job.succeeded} succeeded,{" "}
                            {job.failed} failed
                          </div>
                          <div className="mt-2 max-w-sm">
                            <ActionProgressBar
                              label="Action progress"
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
                          </div>
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
                    A product price check is already active. Full-store checks wait; selected
                    checks can still start when the products do not overlap.
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
                      hasActivePriceJobs ||
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
                      {data.queues.failedChecks.length} visible failed product
                      {data.queues.failedChecks.length === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <ActionButton
                    onClick={startVisibleFailedPriceCheck}
                    disabled={
                      workerOffline ||
                      data.queues.failedChecks.length === 0 ||
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
                      {data.queues.lowStock.length} visible low-stock product
                      {data.queues.lowStock.length === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <ActionButton
                    onClick={startVisibleLowStockPriceCheck}
                    disabled={
                      workerOffline ||
                      data.queues.lowStock.length === 0 ||
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
                      Batch Safe eBay research
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Queue up to 5 product names with 30 seconds between API searches.
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
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.checked}/{job.total} checked, {job.pendingReview} pending,{" "}
                            {job.failed} failed
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
                              {actionJobLabel(job.type)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(job.status)}`}
                            >
                              {job.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {job.processed}/{job.total} processed, {job.succeeded} succeeded,{" "}
                            {job.failed} failed
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
