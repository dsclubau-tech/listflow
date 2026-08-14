"use client";

import ActionProgressBar from "@/components/ActionProgressBar";
import { useCallback, useEffect, useMemo, useState } from "react";

type ResearchStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSING"
  | "PAUSED"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";
type ResearchBatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSING"
  | "PAUSED"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";
type ResearchMode = "ACTIVE" | "SOLD" | "BOTH";
type ResearchConditionFilter =
  | "ANY"
  | "NEW"
  | "USED"
  | "NEW_OTHER"
  | "REFURBISHED"
  | "PARTS_NOT_WORKING";
type ResearchPhase = "QUICK" | "REFINING" | "COMPLETE";
type ResultTab = "ACTIVE" | "SOLD";

const CONDITION_FILTER_OPTIONS: Array<{
  value: ResearchConditionFilter;
  label: string;
}> = [
  { value: "ANY", label: "Any condition" },
  { value: "NEW", label: "New" },
  { value: "USED", label: "Used" },
  { value: "NEW_OTHER", label: "New other / open box" },
  { value: "REFURBISHED", label: "Refurbished" },
  { value: "PARTS_NOT_WORKING", label: "For parts / not working" },
];

const MAX_BATCH_QUERIES = 50;
const BATCH_GROUP_SIZE = 5;
const BATCH_GROUP_COOLDOWN_MINUTES = 2;

type ResearchSummary = {
  count: number;
  distinctSellers: number;
  lowestPrice: string | null;
  averageLowest10: string | null;
  medianPrice: string | null;
  totalSoldQuantity: number;
  generatedAt: string;
};

type ResultSortDirection = "asc" | "desc";

type ResearchResult = {
  source: "ACTIVE" | "SOLD";
  itemId: string | null;
  title: string;
  url: string;
  imageUrl: string | null;
  seller: string | null;
  condition: string | null;
  itemPrice: string;
  shippingPrice: string;
  landedPrice: string;
  currency: "AUD";
  location: string | null;
  listedAt?: string | null;
  soldAt?: string | null;
  matchScore?: number;
  soldQuantity?: number | null;
  soldCountText?: string | null;
};

type ResearchJob = {
  id: string;
  storeId: string;
  batchId: string | null;
  batchStatus: ResearchBatchStatus | null;
  queuePosition: number | null;
  canPause: boolean;
  canResume: boolean;
  cooldownUntil: string | null;
  status: ResearchStatus;
  phase: ResearchPhase;
  mode: ResearchMode;
  conditionFilter: ResearchConditionFilter;
  query: string;
  limit: number;
  activeCount: number;
  soldCount: number;
  activeSummary: ResearchSummary;
  soldSummary: ResearchSummary;
  activeResults: ResearchResult[];
  soldResults: ResearchResult[];
  warningMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type ResearchBatch = {
  id: string;
  storeId: string;
  status: ResearchBatchStatus;
  total: number;
  completed: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
  canPause: boolean;
  canResume: boolean;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  jobs: ResearchJob[];
};

interface EbayResearchClientProps {
  initialJobs: ResearchJob[];
  initialBatches: ResearchBatch[];
  initialError?: string | null;
}

function isActiveJob(job: ResearchJob | null) {
  return (
    job?.status === "QUEUED" ||
    job?.status === "RUNNING" ||
    job?.status === "PAUSING"
  );
}

function getResearchJobProgress(job: ResearchJob | null) {
  if (!job) {
    return 0;
  }

  if (job.status === "COMPLETED" || job.status === "PARTIAL") {
    return 100;
  }

  if (job.status === "FAILED") {
    return 100;
  }

  if (job.status === "QUEUED") {
    return 5;
  }

  if (job.phase === "REFINING") {
    return 75;
  }

  if (job.phase === "QUICK") {
    return 35;
  }

  return 90;
}

function getResearchBatchProgress(batch: ResearchBatch) {
  if (batch.total <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(((batch.completed + batch.failed) / batch.total) * 100),
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function formatMoney(value: string | null | undefined) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "-";
  }

  return `A$${numeric.toFixed(2)}`;
}

function parseMoney(value: string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function statusClasses(status: ResearchStatus) {
  if (status === "COMPLETED") {
    return "bg-green-100 text-green-700";
  }

  if (status === "PARTIAL") {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "FAILED") {
    return "bg-red-100 text-red-700";
  }

  if (status === "PAUSING" || status === "PAUSED") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-blue-100 text-blue-700";
}

function mergeJob(jobs: ResearchJob[], job: ResearchJob) {
  return [job, ...jobs.filter((existing) => existing.id !== job.id)].slice(0, 25);
}

function mergeBatch(batches: ResearchBatch[], batch: ResearchBatch) {
  return [batch, ...batches.filter((existing) => existing.id !== batch.id)].slice(0, 10);
}

function isActiveBatch(batch: ResearchBatch) {
  return (
    batch.status === "QUEUED" ||
    batch.status === "RUNNING" ||
    batch.status === "PAUSING"
  );
}

function isCurrentBatch(batch: ResearchBatch) {
  return isActiveBatch(batch) || batch.status === "PAUSED";
}

function getBatchStatusLabel(batch: ResearchBatch) {
  if (batch.status === "RUNNING") {
    return batch.cooldownUntil ? "Cooling down" : "Running";
  }

  if (batch.status === "PAUSING") {
    return "Pausing after current search";
  }

  if (batch.status === "PAUSED") {
    return "Paused";
  }

  if (batch.status === "QUEUED") {
    return "Queued";
  }

  return batch.status.toLowerCase();
}

function normalizeBatchInput(value: string) {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const line of value.split(/\r?\n/)) {
    const query = line.trim();
    const key = query.toLowerCase();

    if (!query || seen.has(key)) {
      continue;
    }

    seen.add(key);
    queries.push(query);
  }

  return queries;
}

function usesSoldComps(mode: ResearchMode) {
  return mode === "SOLD" || mode === "BOTH";
}

function getJobModeLabel(job: ResearchJob) {
  if (job.mode === "ACTIVE") {
    return job.batchId ? "Batch Safe Mode" : "Safe Mode";
  }

  if (job.mode === "SOLD") {
    return "Advanced sold comps";
  }

  return "Advanced active + sold";
}

function getConditionFilterLabel(value: ResearchConditionFilter) {
  return (
    CONDITION_FILTER_OPTIONS.find((option) => option.value === value)?.label ??
    "Any condition"
  );
}

function getBatchConditionLabel(batch: ResearchBatch) {
  const firstCondition = batch.jobs[0]?.conditionFilter ?? "ANY";
  const allSameCondition = batch.jobs.every(
    (job) => job.conditionFilter === firstCondition
  );

  return allSameCondition
    ? getConditionFilterLabel(firstCondition)
    : "Mixed conditions";
}

function getBatchCooldownEstimate(queryCount: number) {
  if (queryCount <= BATCH_GROUP_SIZE) {
    return null;
  }

  const cooldownCount = Math.ceil(queryCount / BATCH_GROUP_SIZE) - 1;
  const cooldownMinutes = cooldownCount * BATCH_GROUP_COOLDOWN_MINUTES;
  const minuteLabel = cooldownMinutes === 1 ? "minute" : "minutes";

  return `Estimated pacing: about ${cooldownMinutes} ${minuteLabel} of cooldown plus search time.`;
}

function SummaryStat({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tracking-tight text-gray-950">{value}</div>
      {subtext && <div className="mt-1 text-xs text-gray-500 truncate" title={subtext}>{subtext}</div>}
    </div>
  );
}

function getSoldText(result: ResearchResult) {
  if (result.soldCountText) {
    return result.soldCountText;
  }

  const quantity = Number(result.soldQuantity);
  return `${Number.isFinite(quantity) && quantity > 0 ? quantity : 1} sold`;
}

function getSellThroughSignal(job: ResearchJob) {
  const soldUnits = job.soldSummary.totalSoldQuantity || job.soldCount;
  const activeCount = job.activeCount;

  if (soldUnits <= 0 || activeCount <= 0) {
    return {
      label: "Insufficient",
      detail: "Need active and sold results for a signal.",
      className: "bg-gray-100 text-gray-700",
    };
  }

  const ratio = soldUnits / activeCount;

  if (ratio >= 1.5) {
    return {
      label: "High",
      detail: `${soldUnits} sold units vs ${activeCount} active listings.`,
      className: "bg-green-100 text-green-700",
    };
  }

  if (ratio >= 0.6) {
    return {
      label: "Medium",
      detail: `${soldUnits} sold units vs ${activeCount} active listings.`,
      className: "bg-amber-100 text-amber-800",
    };
  }

  return {
    label: "Low",
    detail: `${soldUnits} sold units vs ${activeCount} active listings.`,
    className: "bg-red-100 text-red-700",
  };
}

function getActiveSoldGap(job: ResearchJob) {
  const activeLowest = parseMoney(job.activeSummary.lowestPrice);
  const soldReference =
    parseMoney(job.soldSummary.medianPrice) ?? parseMoney(job.soldSummary.lowestPrice);

  if (activeLowest === null || soldReference === null) {
    return {
      label: "-",
      detail: "Need active and sold prices for the gap.",
    };
  }

  const gap = activeLowest - soldReference;
  const prefix = gap > 0 ? "+" : "";

  return {
    label: `${prefix}A$${gap.toFixed(2)}`,
    detail:
      gap > 0
        ? "Lowest active is above median sold."
        : gap < 0
          ? "Lowest active is below median sold."
          : "Lowest active matches median sold.",
  };
}

function ResultsTable({
  results,
  emptyLabel,
  tab,
}: {
  results: ResearchResult[];
  emptyLabel: string;
  tab: ResultTab;
}) {
  if (results.length === 0) {
    return (
      <div className="border-t border-gray-200 px-4 py-12 text-center text-sm text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Listing</th>
            <th className="px-4 py-3">Seller</th>
            <th className="px-4 py-3">Condition</th>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3">Shipping</th>
            <th className="px-4 py-3">Landed</th>
            <th className="px-4 py-3">Location</th>
            <th className="px-4 py-3">{tab === "SOLD" ? "Sold" : "Listed"}</th>
            <th className="px-4 py-3 text-right">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {results.map((result) => (
            <tr
              key={`${result.source}-${result.itemId ?? result.url}`}
              className="bg-white hover:bg-gray-50/50 transition-colors"
            >
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {result.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result.imageUrl}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="max-w-sm truncate font-medium text-gray-900" title={result.title}>
                      {result.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {result.itemId && (
                        <span className="font-mono text-xs text-gray-500">{result.itemId}</span>
                      )}
                      {typeof result.matchScore === "number" && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Match {result.matchScore}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {result.seller || "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {result.condition || "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                {formatMoney(result.itemPrice)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {formatMoney(result.shippingPrice)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-bold text-gray-950">
                {formatMoney(result.landedPrice)}
              </td>
              <td className="max-w-[160px] truncate px-4 py-3 text-gray-700" title={result.location ?? ""}>
                {result.location || "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {tab === "SOLD" ? getSoldText(result) : formatDate(result.listedAt ?? null)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EbayResearchClient({
  initialJobs,
  initialBatches,
  initialError = null,
}: EbayResearchClientProps) {
  const [query, setQuery] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchTab, setSearchTab] = useState<"single" | "batch">("single");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("all");
  const [listFilterQuery, setListFilterQuery] = useState("");
  const [mode, setMode] = useState<ResearchMode>("BOTH");
  const [conditionFilter, setConditionFilter] =
    useState<ResearchConditionFilter>("ANY");
  const [batchConditionFilter, setBatchConditionFilter] =
    useState<ResearchConditionFilter>("ANY");
  const [limit, setLimit] = useState("30");
  const [advancedSoldComps, setAdvancedSoldComps] = useState(false);
  const [jobs, setJobs] = useState(initialJobs);
  const [batches, setBatches] = useState(initialBatches);
  const [selectedJob, setSelectedJob] = useState<ResearchJob | null>(() => {
    if (initialJobs.length > 0) return initialJobs[0];
    const firstBatchJob = initialBatches[0]?.jobs?.[0];
    return firstBatchJob ?? null;
  });
  const [activeTab, setActiveTab] = useState<ResultTab>("ACTIVE");
  const [resultSort, setResultSort] = useState<ResultSortDirection>("asc");
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchActionId, setBatchActionId] = useState<string | null>(null);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  const batchQueries = useMemo(() => normalizeBatchInput(batchInput), [batchInput]);
  const batchCooldownEstimate = getBatchCooldownEstimate(batchQueries.length);
  const activeBatchExists = batches.some(isActiveBatch);

  const currentBatch = useMemo(() => {
    if (selectedBatchId !== "all") {
      return batches.find((b) => b.id === selectedBatchId) ?? null;
    }
    return batches.find(isCurrentBatch) ?? batches[0] ?? null;
  }, [batches, selectedBatchId]);

  const allResearchJobs = useMemo(() => {
    const map = new Map<string, ResearchJob>();
    for (const batch of batches) {
      for (const job of batch.jobs ?? []) {
        map.set(job.id, job);
      }
    }
    for (const job of jobs) {
      if (!map.has(job.id)) {
        map.set(job.id, job);
      }
    }
    return Array.from(map.values());
  }, [batches, jobs]);

  const displayedJobs = useMemo(() => {
    let sourceJobs: ResearchJob[] = [];
    if (selectedBatchId === "all") {
      sourceJobs = allResearchJobs;
    } else {
      const batch = batches.find((b) => b.id === selectedBatchId);
      sourceJobs = batch?.jobs ?? [];
    }

    if (!listFilterQuery.trim()) {
      return sourceJobs;
    }

    const words = listFilterQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return sourceJobs.filter((job) => {
      const target = `${job.query} ${job.status}`.toLowerCase();
      return (
        target.includes(listFilterQuery.toLowerCase().trim()) ||
        words.every((word) => target.includes(word))
      );
    });
  }, [allResearchJobs, batches, selectedBatchId, listFilterQuery]);

  useEffect(() => {
    if (!selectedJob && allResearchJobs.length > 0) {
      setSelectedJob(allResearchJobs[0]);
    }
  }, [selectedJob, allResearchJobs]);

  const activeResults = selectedJob?.activeResults ?? [];
  const soldResults = selectedJob?.soldResults ?? [];
  const selectedActive = isActiveJob(selectedJob);
  const availableTabs: ResultTab[] =
    selectedJob?.mode === "ACTIVE"
      ? ["ACTIVE"]
      : selectedJob?.mode === "SOLD"
        ? ["SOLD"]
        : ["ACTIVE", "SOLD"];
  const unsortedResults = activeTab === "ACTIVE" ? activeResults : soldResults;
  const visibleResults = useMemo(() => {
    const sorted = [...unsortedResults];
    sorted.sort((left, right) => {
      const leftPrice = parseMoney(left.landedPrice) ?? Number.POSITIVE_INFINITY;
      const rightPrice =
        parseMoney(right.landedPrice) ?? Number.POSITIVE_INFINITY;

      return resultSort === "asc"
        ? leftPrice - rightPrice
        : rightPrice - leftPrice;
    });

    return sorted;
  }, [unsortedResults, resultSort]);
  const emptyLabel =
    activeTab === "ACTIVE"
      ? "No active listings saved for this job."
      : "No sold comps saved for this job.";

  const statusLabel = useMemo(() => {
    if (!selectedJob) {
      return "Ready";
    }

    if (selectedJob.status === "QUEUED") {
      return "Queued";
    }

    if (selectedJob.status === "RUNNING") {
      return selectedJob.phase === "REFINING"
        ? "Refining results..."
        : "Searching eBay AU...";
    }

    if (selectedJob.status === "PAUSING") {
      return "Pausing after current search";
    }

    if (selectedJob.status === "PAUSED") {
      return "Paused";
    }

    return selectedJob.status.toLowerCase();
  }, [selectedJob]);

  const marketSignals = useMemo(() => {
    if (!selectedJob || !usesSoldComps(selectedJob.mode)) {
      return null;
    }

    return {
      sellThrough: getSellThroughSignal(selectedJob),
      priceGap: getActiveSoldGap(selectedJob),
    };
  }, [selectedJob]);

  const refreshJobs = useCallback(async () => {
    const response = await fetch("/api/ebay-research/jobs", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as {
      jobs?: ResearchJob[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load research history");
    }

    setJobs(data.jobs ?? []);
  }, []);

  async function clearAllResearch() {
    if (!window.confirm("Clear all completed research history and cached results?")) {
      return;
    }

    setError(null);

    try {
      const response = await fetch("/api/ebay-research/jobs", {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to clear research data");
      }

      setJobs([]);
      setBatches([]);
      setSelectedJob(null);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }

  const refreshBatches = useCallback(async () => {
    const response = await fetch("/api/ebay-research/batches/current", {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      batches?: ResearchBatch[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load research batches");
    }

    const nextBatches = data.batches ?? [];
    const batchJobs = nextBatches.flatMap((batch) => batch.jobs ?? []);

    setBatches(nextBatches);
    setJobs((current) =>
      batchJobs.reduce((nextJobs, job) => mergeJob(nextJobs, job), current)
    );
  }, []);

  const fetchJob = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/ebay-research/jobs/${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
    );
    const data = (await response.json().catch(() => ({}))) as {
      job?: ResearchJob;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load research job");
    }

    return data.job ?? null;
  }, []);

  async function startResearch(overrides?: {
    query?: string;
    mode?: ResearchMode;
    limit?: number;
    conditionFilter?: ResearchConditionFilter;
  }) {
    const nextQuery = (overrides?.query ?? query).trim();
    const requestedMode = overrides?.mode ?? (advancedSoldComps ? mode : "ACTIVE");
    const requestedConditionFilter =
      overrides?.conditionFilter ?? conditionFilter;

    if (!nextQuery) {
      setError("Enter a product name to research.");
      return;
    }

    if (
      usesSoldComps(requestedMode) &&
      !window.confirm(
        "Sold comps use browser scraping on eBay pages and may be blocked or throttled by eBay. Safe Mode avoids this by using the official API only. Continue with advanced sold comps?"
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/ebay-research/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: nextQuery,
          mode: requestedMode,
          limit: overrides?.limit ?? Number.parseInt(limit, 10),
          conditionFilter: requestedConditionFilter,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        job?: ResearchJob;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to start research job");
      }

      if (!data.job) {
        throw new Error("Research job response did not include a job");
      }

      setSelectedJob(data.job);
      setJobs((current) => mergeJob(current, data.job!));
      setActiveTab(data.job.mode === "SOLD" ? "SOLD" : "ACTIVE");
      setAdvancedSoldComps(usesSoldComps(data.job.mode));
      setConditionFilter(data.job.conditionFilter);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function startBatchResearch() {
    if (batchQueries.length === 0) {
      setError("Enter at least one product name for the batch.");
      return;
    }

    if (batchQueries.length > MAX_BATCH_QUERIES) {
      setError(
        `Batch Safe Search supports up to ${MAX_BATCH_QUERIES} product names.`
      );
      return;
    }

    setBatchSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/ebay-research/jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: batchQueries,
          limit: Number.parseInt(limit, 10),
          conditionFilter: batchConditionFilter,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        batch?: ResearchBatch;
        jobs?: ResearchJob[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to start research batch");
      }

      if (!data.batch) {
        throw new Error("Research batch response did not include a batch");
      }

      setBatches((current) => mergeBatch(current, data.batch!));
      setJobs((current) =>
        (data.jobs ?? data.batch!.jobs ?? []).reduce(
          (nextJobs, job) => mergeJob(nextJobs, job),
          current
        )
      );

      const firstJob = (data.jobs ?? data.batch.jobs ?? [])[0];
      if (firstJob) {
        setSelectedJob(firstJob);
        setActiveTab("ACTIVE");
        setBatchConditionFilter(firstJob.conditionFilter);
      }

      setBatchInput("");
      void refreshBatches().catch(() => undefined);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function updateBatchStatus(batch: ResearchBatch, action: "pause" | "resume") {
    setBatchActionId(`${action}:${batch.id}`);
    setError(null);

    try {
      const response = await fetch(
        `/api/ebay-research/batches/${encodeURIComponent(batch.id)}/${action}`,
        { method: "POST" }
      );
      const data = (await response.json().catch(() => ({}))) as {
        batch?: ResearchBatch;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} research batch`);
      }

      if (data.batch) {
        setBatches((current) => mergeBatch(current, data.batch!));
        setJobs((current) =>
          (data.batch!.jobs ?? []).reduce(
            (nextJobs, job) => mergeJob(nextJobs, job),
            current
          )
        );
      }

      void refreshBatches().catch(() => undefined);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setBatchActionId(null);
    }
  }

  async function openJob(jobId: string) {
    setLoadingJobId(jobId);
    setError(null);

    try {
      const job = await fetchJob(jobId);

      if (job) {
        setSelectedJob(job);
        setJobs((current) => mergeJob(current, job));
        setActiveTab(job.mode === "SOLD" ? "SOLD" : "ACTIVE");
        setAdvancedSoldComps(usesSoldComps(job.mode));
        setConditionFilter(job.conditionFilter);
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingJobId(null);
    }
  }

  function rerunJob(job: ResearchJob) {
    setQuery(job.query);
    setMode(job.mode);
    setLimit(String(job.limit === 25 ? 30 : Math.min(job.limit, 30)));
    setConditionFilter(job.conditionFilter);
    setAdvancedSoldComps(usesSoldComps(job.mode));
    void startResearch({
      query: job.query,
      mode: job.mode,
      limit: job.limit === 25 ? 30 : Math.min(job.limit, 30),
      conditionFilter: job.conditionFilter,
    });
  }

  useEffect(() => {
    if (!selectedJob?.id || !selectedActive) {
      return;
    }

    const jobId = selectedJob.id;
    let cancelled = false;

    async function pollJob() {
      try {
        const job = await fetchJob(jobId);

        if (!cancelled && job) {
          setSelectedJob(job);
          setJobs((current) => mergeJob(current, job));

          if (!isActiveJob(job)) {
            void refreshJobs().catch(() => undefined);
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError));
        }
      }
    }

    const intervalId = window.setInterval(pollJob, 2000);
    void pollJob();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [fetchJob, refreshJobs, selectedActive, selectedJob?.id]);

  useEffect(() => {
    if (!activeBatchExists) {
      return;
    }

    let cancelled = false;

    async function pollBatches() {
      try {
        await refreshBatches();
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError));
        }
      }
    }

    const intervalId = window.setInterval(pollBatches, 3000);
    void pollBatches();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeBatchExists, refreshBatches]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">eBay Research</h1>
          <p className="mt-1 text-sm text-gray-500">
            Research eBay AU active prices and sold comps without changing listings.
          </p>
        </div>
        {selectedJob && (
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusClasses(
              selectedJob.status
            )}`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {/* Search & Batch Input Card */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3.5 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchTab("single")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                searchTab === "single"
                  ? "bg-gray-900 text-white shadow-xs"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Single Search
            </button>
            <button
              type="button"
              onClick={() => setSearchTab("batch")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                searchTab === "batch"
                  ? "bg-gray-900 text-white shadow-xs"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Batch Safe Search
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              Safe Mode (API only)
            </span>
            <button
              type="button"
              onClick={() => {
                setAdvancedSoldComps((current) => {
                  const next = !current;
                  if (next && mode === "ACTIVE") {
                    setMode("BOTH");
                  }
                  return next;
                });
              }}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 underline transition-colors"
            >
              {advancedSoldComps ? "Return to Safe Mode" : "Advanced / Sold comps"}
            </button>
          </div>
        </div>

        {searchTab === "single" ? (
          <form
            className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_190px_130px_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void startResearch();
            }}
          >
            <div>
              <label htmlFor="research-query" className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Product name
              </label>
              <input
                id="research-query"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Sony WH-1000XM5 headphones"
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
            <div>
              <label htmlFor="research-condition" className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Condition
              </label>
              <select
                id="research-condition"
                value={conditionFilter}
                onChange={(event) =>
                  setConditionFilter(event.target.value as ResearchConditionFilter)
                }
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              >
                {CONDITION_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="research-limit" className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Results
              </label>
              <select
                id="research-limit"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              >
                <option value="10">10</option>
                <option value="30">30</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9.5 items-center justify-center rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Searching..."
                : advancedSoldComps
                  ? "Start Advanced Search"
                  : "Search Safe Mode"}
            </button>
          </form>
        ) : (
          <div className="p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="research-batch"
                    className="block text-xs font-semibold uppercase tracking-wider text-gray-700"
                  >
                    Batch Safe Search Queries
                  </label>
                  <span
                    className={`text-xs font-medium ${
                      batchQueries.length > MAX_BATCH_QUERIES
                        ? "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {batchQueries.length}/{MAX_BATCH_QUERIES} names
                  </span>
                </div>
                <textarea
                  id="research-batch"
                  value={batchInput}
                  onChange={(event) => setBatchInput(event.target.value)}
                  rows={4}
                  placeholder={"One product name per line\ntile cutter 24 inch, Double Guide Rails\nBlueAnt Pump Air ANC2\nSony WH-1000XM5"}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Runs 5 API-only searches per batch with cooldown. Results saved for 24 hours.
                </p>
                {batchCooldownEstimate && (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    {batchCooldownEstimate}
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="research-batch-condition"
                    className="block text-xs font-semibold uppercase tracking-wider text-gray-700"
                  >
                    Condition
                  </label>
                  <select
                    id="research-batch-condition"
                    value={batchConditionFilter}
                    onChange={(event) =>
                      setBatchConditionFilter(
                        event.target.value as ResearchConditionFilter
                      )
                    }
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  >
                    {CONDITION_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void startBatchResearch()}
                  disabled={
                    batchSubmitting ||
                    batchQueries.length === 0 ||
                    batchQueries.length > MAX_BATCH_QUERIES
                  }
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {batchSubmitting ? "Queueing Batch..." : "Start Batch Safe Search"}
                </button>
              </div>
            </div>
          </div>
        )}

        {advancedSoldComps && (
          <div className="border-t border-amber-200 bg-amber-50/70 px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
              <div>
                <label htmlFor="research-mode" className="block text-xs font-semibold uppercase tracking-wider text-amber-900">
                  Advanced search type
                </label>
                <select
                  id="research-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as ResearchMode)}
                  className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                >
                  <option value="BOTH">Active + sold comps</option>
                  <option value="SOLD">Sold comps only</option>
                </select>
              </div>
              <div className="text-xs leading-5 text-amber-900">
                <div className="font-semibold">Sold comps are higher risk.</div>
                <p className="mt-0.5">
                  This mode uses browser scraping on eBay sold/completed result pages and may be throttled. You will be asked to confirm before it starts.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
      </section>

      {/* Master-Detail 2-Column Split Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Search Items / Batch Queue */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-4">
          {/* Active/Selected Batch Queue Card */}
          {currentBatch && (
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-900">
                    Batch Queue
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(
                      currentBatch.status
                    )}`}
                  >
                    {getBatchStatusLabel(currentBatch)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {currentBatch.canPause && (
                    <button
                      type="button"
                      onClick={() => void updateBatchStatus(currentBatch, "pause")}
                      disabled={batchActionId === `pause:${currentBatch.id}`}
                      className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {batchActionId === `pause:${currentBatch.id}` ? "Pausing..." : "Pause"}
                    </button>
                  )}
                  {currentBatch.canResume && (
                    <button
                      type="button"
                      onClick={() => void updateBatchStatus(currentBatch, "resume")}
                      disabled={batchActionId === `resume:${currentBatch.id}`}
                      className="rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {batchActionId === `resume:${currentBatch.id}` ? "Resuming..." : "Resume"}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 space-y-2">
                <div className="text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">
                    {currentBatch.completed}/{currentBatch.total}
                  </span>{" "}
                  complete · {getBatchConditionLabel(currentBatch)}
                  {currentBatch.failed > 0 && `, ${currentBatch.failed} failed`}
                  {currentBatch.running > 0 && `, ${currentBatch.running} running`}
                  {currentBatch.queued > 0 && `, ${currentBatch.queued} queued`}
                </div>
                <ActionProgressBar
                  label="Batch progress"
                  percent={getResearchBatchProgress(currentBatch)}
                  tone={
                    currentBatch.status === "PAUSED" || currentBatch.status === "PAUSING"
                      ? "amber"
                      : "blue"
                  }
                  compact
                />
                {currentBatch.cooldownUntil && (
                  <div className="text-xs text-amber-700 font-medium">
                    Next search after {formatDate(currentBatch.cooldownUntil)}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Search Items Master List Card */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-4 bg-gray-50/50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900">
                    Search Items
                  </h2>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                    {displayedJobs.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {allResearchJobs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void clearAllResearch()}
                      className="text-xs font-medium text-gray-500 hover:text-red-600 transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void Promise.all([
                        refreshBatches().catch(() => undefined),
                        refreshJobs().catch(() => undefined),
                      ])
                    }
                    className="text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {/* Batch Selector Dropdown */}
              {batches.length > 0 && (
                <div>
                  <label htmlFor="batch-select" className="sr-only">
                    Select Batch
                  </label>
                  <select
                    id="batch-select"
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  >
                    <option value="all">
                      All Searches ({allResearchJobs.length} items from {batches.length} batches)
                    </option>
                    {batches.map((batch, index) => (
                      <option key={batch.id} value={batch.id}>
                        Batch {batches.length - index}: {batch.jobs.length} items · {batch.status} ({formatDate(batch.createdAt)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick Filter Input */}
              <div className="relative">
                <input
                  type="text"
                  value={listFilterQuery}
                  onChange={(e) => setListFilterQuery(e.target.value)}
                  placeholder="Filter search items..."
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                {listFilterQuery && (
                  <button
                    type="button"
                    onClick={() => setListFilterQuery("")}
                    className="absolute right-2.5 top-1.5 text-xs text-gray-400 hover:text-gray-600"
                    title="Clear filter"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* List Body */}
            {displayedJobs.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 space-y-2">
                {listFilterQuery ? (
                  <>
                    <p>No search items match &ldquo;{listFilterQuery}&rdquo;</p>
                    <button
                      type="button"
                      onClick={() => setListFilterQuery("")}
                      className="inline-flex rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Clear Filter
                    </button>
                  </>
                ) : (
                  <p>No research queries yet. Start a search above.</p>
                )}
              </div>
            ) : (
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-gray-100">
                {displayedJobs.map((job, index) => {
                  const isSelected = selectedJob?.id === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => void openJob(job.id)}
                      disabled={loadingJobId === job.id}
                      className={`w-full text-left p-3.5 transition-all flex flex-col gap-1.5 ${
                        isSelected
                          ? "bg-orange-50/70 border-l-4 border-l-orange-500 pl-3"
                          : "hover:bg-gray-50 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-xs font-bold text-gray-400 mt-0.5 shrink-0">
                            #{index + 1}
                          </span>
                          <span
                            className={`text-sm font-semibold line-clamp-2 ${
                              isSelected ? "text-orange-950" : "text-gray-900"
                            }`}
                            title={job.query}
                          >
                            {job.query}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(
                            job.status
                          )}`}
                        >
                          {job.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 pl-5">
                        <span>{job.activeCount} results</span>
                        <span>·</span>
                        <span>{getJobModeLabel(job)}</span>
                        {job.queuePosition && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-amber-700">Queue #{job.queuePosition}</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: "Results of selected" */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-6">
          {selectedJob ? (
            <>
              {/* Selected Product Header Card */}
              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="p-5 md:p-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-xl font-bold tracking-tight text-gray-950">
                        {selectedJob.query}
                      </h2>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">
                        {getJobModeLabel(selectedJob)}
                      </span>
                      <span>·</span>
                      <span>{getConditionFilterLabel(selectedJob.conditionFilter)}</span>
                      <span>·</span>
                      <span>limit {selectedJob.limit}</span>
                      {selectedJob.mode === "ACTIVE" && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          API-only
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => rerunJob(selectedJob)}
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Rerun
                    </button>
                    <a
                      href={`https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(selectedJob.query)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 transition-colors"
                    >
                      Open on eBay
                      <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>

                {selectedActive && (
                  <div className="border-t border-gray-100 bg-blue-50/50 px-5 py-3">
                    <ActionProgressBar
                      label={
                        selectedJob.phase === "REFINING"
                          ? "Refining results..."
                          : "Searching eBay AU..."
                      }
                      percent={getResearchJobProgress(selectedJob)}
                      tone="blue"
                    />
                  </div>
                )}
              </section>

              {/* Summary Stat Cards Grid */}
              <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                {selectedJob.mode !== "SOLD" && (
                  <SummaryStat
                    label="Lowest active"
                    value={formatMoney(selectedJob.activeSummary.lowestPrice)}
                    subtext={`${selectedJob.activeCount} listings · ${selectedJob.activeSummary.distinctSellers} sellers`}
                  />
                )}
                {selectedJob.mode === "ACTIVE" ? (
                  <>
                    <SummaryStat
                      label="Median active"
                      value={formatMoney(selectedJob.activeSummary.medianPrice)}
                      subtext="Official eBay API"
                    />
                    <SummaryStat
                      label="Active low 10 avg"
                      value={formatMoney(selectedJob.activeSummary.averageLowest10)}
                    />
                    <SummaryStat
                      label="Safe Mode"
                      value="API-only"
                      subtext={
                        selectedJob.completedAt
                          ? `Done ${formatDate(selectedJob.completedAt)}${
                              formatDuration(selectedJob.startedAt, selectedJob.completedAt)
                                ? ` (${formatDuration(selectedJob.startedAt, selectedJob.completedAt)})`
                                : ""
                            }`
                          : "Sold comps off"
                      }
                    />
                  </>
                ) : (
                  <>
                    <SummaryStat
                      label="Lowest sold"
                      value={formatMoney(selectedJob.soldSummary.lowestPrice)}
                      subtext={`${selectedJob.soldCount} comps · ${selectedJob.soldSummary.distinctSellers} sellers`}
                    />
                    <SummaryStat
                      label="Sold units"
                      value={String(selectedJob.soldSummary.totalSoldQuantity || selectedJob.soldCount)}
                      subtext="Buy It Now sold comps"
                    />
                    <SummaryStat
                      label="Median sold"
                      value={formatMoney(selectedJob.soldSummary.medianPrice)}
                      subtext={
                        selectedJob.completedAt
                          ? `Done ${formatDate(selectedJob.completedAt)}${
                              formatDuration(selectedJob.startedAt, selectedJob.completedAt)
                                ? ` (${formatDuration(selectedJob.startedAt, selectedJob.completedAt)})`
                                : ""
                            }`
                          : undefined
                      }
                    />
                  </>
                )}
              </section>

              {/* Market Signals Card */}
              {marketSignals && (
                <section className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Sell-through signal
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          {marketSignals.sellThrough.detail}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${marketSignals.sellThrough.className}`}
                      >
                        {marketSignals.sellThrough.label}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Active vs sold gap
                    </div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-lg font-bold text-gray-950">
                        {marketSignals.priceGap.label}
                      </span>
                      <span className="text-xs text-gray-600">
                        {marketSignals.priceGap.detail}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              {/* Warnings or Errors */}
              {(selectedJob.warningMessage || selectedJob.errorMessage) && (
                <section
                  className={`rounded-2xl border p-4 text-xs font-medium ${
                    selectedJob.errorMessage
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {selectedJob.errorMessage || selectedJob.warningMessage}
                </section>
              )}

              {/* Results Table Panel */}
              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 pt-3 bg-gray-50/50">
                  <div className="flex gap-1">
                    {availableTabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`border-b-2 px-4 py-2.5 text-xs font-bold transition-colors ${
                          activeTab === tab
                            ? "border-orange-500 text-orange-600"
                            : "border-transparent text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        {tab === "ACTIVE"
                          ? `Active listings (${activeResults.length})`
                          : `Sold comps (${soldResults.length})`}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs font-medium text-gray-600">
                    Sort
                    <select
                      value={resultSort}
                      onChange={(event) =>
                        setResultSort(event.target.value as ResultSortDirection)
                      }
                      className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 shadow-xs focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    >
                      <option value="asc">Lowest price first</option>
                      <option value="desc">Highest price first</option>
                    </select>
                  </label>
                </div>

                <ResultsTable results={visibleResults} emptyLabel={emptyLabel} tab={activeTab} />
              </section>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center shadow-sm">
              <div className="rounded-full bg-orange-50 p-4 ring-1 ring-orange-200">
                <svg className="h-8 w-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm2.25-9.75h-4.5m4.5 3h-4.5" />
                </svg>
              </div>
              <h3 className="mt-4 text-base font-semibold text-gray-900">
                No Search Selected
              </h3>
              <p className="mt-1.5 max-w-sm text-xs text-gray-500">
                Select a search query from the list on the left or run a new search above to view active listings, pricing metrics, and competitor stats.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
