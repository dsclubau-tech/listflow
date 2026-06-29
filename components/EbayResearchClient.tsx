"use client";

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

type ResearchSummary = {
  count: number;
  lowestPrice: string | null;
  averageLowest10: string | null;
  medianPrice: string | null;
  totalSoldQuantity: number;
  generatedAt: string;
};

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
    <div className="border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
      {subtext && <div className="mt-1 text-xs text-gray-500">{subtext}</div>}
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
      <div className="border-t border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="w-full min-w-[1040px] text-left text-sm">
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
            <th className="px-4 py-3">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {results.map((result) => (
            <tr key={`${result.source}-${result.itemId ?? result.url}`} className="bg-white">
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50">
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
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">
                {formatMoney(result.landedPrice)}
              </td>
              <td className="max-w-[180px] truncate px-4 py-3 text-gray-700" title={result.location ?? ""}>
                {result.location || "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {tab === "SOLD" ? getSoldText(result) : formatDate(result.listedAt ?? null)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:text-blue-700"
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
  const [mode, setMode] = useState<ResearchMode>("BOTH");
  const [conditionFilter, setConditionFilter] =
    useState<ResearchConditionFilter>("ANY");
  const [limit, setLimit] = useState("25");
  const [advancedSoldComps, setAdvancedSoldComps] = useState(false);
  const [jobs, setJobs] = useState(initialJobs);
  const [batches, setBatches] = useState(initialBatches);
  const [selectedJob, setSelectedJob] = useState<ResearchJob | null>(
    initialJobs[0] ?? null
  );
  const [activeTab, setActiveTab] = useState<ResultTab>("ACTIVE");
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchActionId, setBatchActionId] = useState<string | null>(null);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  const batchQueries = useMemo(() => normalizeBatchInput(batchInput), [batchInput]);
  const visibleBatches = batches.filter(isCurrentBatch);
  const activeBatchExists = batches.some(isActiveBatch);
  const activeResults = selectedJob?.activeResults ?? [];
  const soldResults = selectedJob?.soldResults ?? [];
  const selectedActive = isActiveJob(selectedJob);
  const availableTabs: ResultTab[] =
    selectedJob?.mode === "ACTIVE"
      ? ["ACTIVE"]
      : selectedJob?.mode === "SOLD"
        ? ["SOLD"]
        : ["ACTIVE", "SOLD"];
  const visibleResults = activeTab === "ACTIVE" ? activeResults : soldResults;
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

    setSelectedJob((current) => {
      if (!current) {
        return current;
      }

      return batchJobs.find((job) => job.id === current.id) ?? current;
    });
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

    if (batchQueries.length > 5) {
      setError("Batch Safe Search supports up to 5 product names.");
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
          conditionFilter,
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
        setConditionFilter(firstJob.conditionFilter);
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
    setLimit(String(Math.min(job.limit, 25)));
    setConditionFilter(job.conditionFilter);
    setAdvancedSoldComps(usesSoldComps(job.mode));
    void startResearch({
      query: job.query,
      mode: job.mode,
      limit: Math.min(job.limit, 25),
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">eBay Research</h1>
          <p className="mt-1 text-sm text-gray-500">
            Research eBay AU active prices and sold comps without changing listings.
          </p>
        </div>
        {selectedJob && (
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusClasses(
              selectedJob.status
            )}`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      <section className="border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              Safe Mode
            </span>
            <p className="text-sm text-gray-600">
              Safe Mode uses official eBay API results only. Sold comps are not included.
            </p>
          </div>
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
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {advancedSoldComps ? "Return to Safe Mode" : "Advanced / Sold comps"}
          </button>
        </div>
        <form
          className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_190px_130px_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void startResearch();
          }}
        >
          <div>
            <label htmlFor="research-query" className="block text-sm font-medium text-gray-700">
              Product name
            </label>
            <input
              id="research-query"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Sony WH-1000XM5 headphones"
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
          <div>
            <label htmlFor="research-condition" className="block text-sm font-medium text-gray-700">
              Condition
            </label>
            <select
              id="research-condition"
              value={conditionFilter}
              onChange={(event) =>
                setConditionFilter(event.target.value as ResearchConditionFilter)
              }
              className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            >
              {CONDITION_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="research-limit" className="block text-sm font-medium text-gray-700">
              Results
            </label>
            <select
              id="research-limit"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            >
              <option value="10">10</option>
              <option value="25">25</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Starting..."
              : advancedSoldComps
                ? "Start Advanced Search"
                : "Search Safe Mode"}
          </button>
        </form>

        <div className="border-t border-gray-200 px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="research-batch"
                  className="block text-sm font-medium text-gray-700"
                >
                  Batch Safe Search
                </label>
                <span
                  className={`text-xs ${
                    batchQueries.length > 5 ? "text-red-600" : "text-gray-500"
                  }`}
                >
                  {batchQueries.length}/5 names
                </span>
              </div>
              <textarea
                id="research-batch"
                value={batchInput}
                onChange={(event) => setBatchInput(event.target.value)}
                rows={5}
                placeholder={"One product per line\nOBDLink EX FORScan OBD Adapter\nSony WH-1000XM5"}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
              <p className="mt-2 text-xs text-gray-500">
                Runs one API-only search at a time with a 30-second cooldown between products.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startBatchResearch()}
              disabled={
                batchSubmitting ||
                batchQueries.length === 0 ||
                batchQueries.length > 5
              }
              className="inline-flex h-10 items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchSubmitting ? "Queueing..." : "Start Batch Safe Search"}
            </button>
          </div>
        </div>

        {advancedSoldComps && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
              <div>
                <label htmlFor="research-mode" className="block text-sm font-medium text-amber-900">
                  Advanced search type
                </label>
                <select
                  id="research-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as ResearchMode)}
                  className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                >
                  <option value="BOTH">Active + sold comps</option>
                  <option value="SOLD">Sold comps only</option>
                </select>
              </div>
              <div className="text-sm text-amber-900">
                <div className="font-medium">Sold comps are higher risk.</div>
                <p className="mt-1">
                  This mode uses browser scraping on eBay sold/completed result pages and may be blocked,
                  throttled, or require manual review. You will be asked to confirm before it starts.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      {batches.length > 0 && (
        <section className="border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="font-semibold text-gray-900">Safe Mode Batch Queue</h2>
              <p className="mt-1 text-sm text-gray-500">
                One search runs at a time. Completed product names are not repeated after recovery.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void refreshBatches().catch((caughtError) =>
                  setError(getErrorMessage(caughtError))
                )
              }
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Refresh
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {(visibleBatches.length > 0 ? visibleBatches : batches.slice(0, 3)).map(
              (batch) => (
                <div key={batch.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          Batch Safe Search
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(
                            batch.status
                          )}`}
                        >
                          {getBatchStatusLabel(batch)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {batch.completed}/{batch.total} complete, {batch.failed} failed,{" "}
                        {batch.running} running, {batch.queued} queued, {batch.paused} paused
                        {batch.cooldownUntil
                          ? ` - next search after ${formatDate(batch.cooldownUntil)}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {batch.canPause && (
                        <button
                          type="button"
                          onClick={() => void updateBatchStatus(batch, "pause")}
                          disabled={batchActionId === `pause:${batch.id}`}
                          className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {batchActionId === `pause:${batch.id}` ? "Pausing..." : "Pause"}
                        </button>
                      )}
                      {batch.canResume && (
                        <button
                          type="button"
                          onClick={() => void updateBatchStatus(batch, "resume")}
                          disabled={batchActionId === `resume:${batch.id}`}
                          className="rounded-md border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {batchActionId === `resume:${batch.id}`
                            ? "Resuming..."
                            : "Resume"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {batch.jobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => void openJob(job.id)}
                        className={`min-w-0 rounded border px-3 py-2 text-left transition-colors ${
                          selectedJob?.id === job.id
                            ? "border-orange-300 bg-orange-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-gray-900">
                            {job.query}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(
                              job.status
                            )}`}
                          >
                            {job.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {job.queuePosition ? `Queue #${job.queuePosition}` : "Safe Mode"} -{" "}
                          {job.activeCount} results - {getConditionFilterLabel(job.conditionFilter)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      )}

      {selectedJob && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {selectedJob.mode !== "SOLD" && (
              <SummaryStat
                label="Lowest active"
                value={formatMoney(selectedJob.activeSummary.lowestPrice)}
                subtext={`${selectedJob.activeCount} active results`}
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
                  subtext={selectedJob.completedAt ? `Done ${formatDate(selectedJob.completedAt)}` : "Sold comps off"}
                />
              </>
            ) : (
              <>
                <SummaryStat
                  label="Lowest sold"
                  value={formatMoney(selectedJob.soldSummary.lowestPrice)}
                  subtext={`${selectedJob.soldCount} sold comps`}
                />
                <SummaryStat
                  label="Sold units"
                  value={String(selectedJob.soldSummary.totalSoldQuantity || selectedJob.soldCount)}
                  subtext="Buy It Now sold comps"
                />
                <SummaryStat
                  label="Median sold"
                  value={formatMoney(selectedJob.soldSummary.medianPrice)}
                  subtext={selectedJob.completedAt ? `Done ${formatDate(selectedJob.completedAt)}` : undefined}
                />
              </>
            )}
          </section>

          {marketSignals && (
            <section className="grid gap-3 md:grid-cols-2">
              <div className="border border-gray-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Sell-through signal
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      {marketSignals.sellThrough.detail}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${marketSignals.sellThrough.className}`}
                  >
                    {marketSignals.sellThrough.label}
                  </span>
                </div>
              </div>
              <div className="border border-gray-200 bg-white px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Active vs sold gap
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-xl font-semibold text-gray-900">
                    {marketSignals.priceGap.label}
                  </span>
                  <span className="text-sm text-gray-600">
                    {marketSignals.priceGap.detail}
                  </span>
                </div>
              </div>
            </section>
          )}

          {(selectedJob.warningMessage || selectedJob.errorMessage) && (
            <section
              className={`border px-4 py-3 text-sm ${
                selectedJob.errorMessage
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {selectedJob.errorMessage || selectedJob.warningMessage}
            </section>
          )}

          <section className="border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="font-semibold text-gray-900">{selectedJob.query}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                  <span>
                    {getJobModeLabel(selectedJob)},{" "}
                    {getConditionFilterLabel(selectedJob.conditionFilter)}, limit{" "}
                    {selectedJob.limit}
                  </span>
                  {selectedJob.mode === "ACTIVE" && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      API-only
                    </span>
                  )}
                </div>
              </div>
              {selectedActive && (
                <div className="flex items-center gap-2 text-sm text-blue-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                  {selectedJob.phase === "REFINING" ? "Refining results" : "Search running"}
                </div>
              )}
            </div>

            <div className="flex border-b border-gray-200 px-4 pt-3">
              {availableTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium ${
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

            <ResultsTable results={visibleResults} emptyLabel={emptyLabel} tab={activeTab} />
          </section>
        </>
      )}

      <section className="border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="font-semibold text-gray-900">Recent Research</h2>
          <button
            type="button"
            onClick={() => void refreshJobs().catch((caughtError) => setError(getErrorMessage(caughtError)))}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Refresh
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-500">
            No research jobs yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                  selectedJob?.id === job.id ? "bg-orange-50" : "bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => void openJob(job.id)}
                  className="min-w-0 flex-1 text-left"
                  disabled={loadingJobId === job.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(
                        job.status
                      )}`}
                    >
                      {job.status}
                    </span>
                    <span className="truncate font-medium text-gray-900">{job.query}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {getJobModeLabel(job)} - {getConditionFilterLabel(job.conditionFilter)} - {job.activeCount} active - {job.soldCount} sold - {formatDate(job.createdAt)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => rerunJob(job)}
                  disabled={submitting}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rerun
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
