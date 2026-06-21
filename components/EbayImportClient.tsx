"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface EbayImportClientProps {
  stores: Array<{ id: string; name: string }>;
}

interface ImportStats {
  storeId: string;
  storeName: string;
  activeListings: number;
  alreadyImported: number;
  remaining: number;
  staleInListFlow: number;
  fetchedAt: string | null;
}

interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  currentItemId?: string;
}

interface ImportResult {
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  remainingAfterImport: number;
  created: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  errors: Array<{ itemId: string; title: string; error: string }>;
}

type ModalState = "confirm" | "importing" | "complete";

type ImportJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

interface ImportJob {
  id: string;
  storeId: string;
  status: ImportJobStatus;
  quantity: number;
  requested: number;
  activeListings: number;
  alreadyImported: number;
  remainingBeforeImport: number;
  remainingAfterImport: number;
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  errors: Array<{ itemId: string; title: string; error: string }>;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface StoredImportJob {
  id: string;
  storeId: string;
}

const IMPORT_JOB_STORAGE_KEY = "listflow:ebay-import:active-job";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function isActiveImportJob(job: ImportJob | null) {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

function readStoredImportJob(): StoredImportJob | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredImportJob>) : null;

    return parsed?.id && parsed.storeId
      ? { id: parsed.id, storeId: parsed.storeId }
      : null;
  } catch {
    return null;
  }
}

function writeStoredImportJob(job: ImportJob) {
  window.localStorage.setItem(
    IMPORT_JOB_STORAGE_KEY,
    JSON.stringify({ id: job.id, storeId: job.storeId }),
  );
}

function clearStoredImportJob(jobId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const stored = readStoredImportJob();

  if (!jobId || stored?.id === jobId) {
    window.localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  }
}

export default function EbayImportClient({ stores }: EbayImportClientProps) {
  const router = useRouter();
  const [selectedStore, setSelectedStore] = useState(stores[0]?.id ?? "");
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [staleRemoving, setStaleRemoving] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [quantityNotice, setQuantityNotice] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [pendingQuantity, setPendingQuantity] = useState(100);
  const [importing, setImporting] = useState(false);
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const selectedStoreRecord = stores.find((store) => store.id === selectedStore);
  const activeJobId = activeJob?.id ?? null;
  const activeJobStatus = activeJob?.status ?? null;
  const activeImportRunning = activeJobStatus === "QUEUED" || activeJobStatus === "RUNNING";
  const parsedQuantity = Number.parseInt(quantity, 10);
  const quantityValue =
    Number.isFinite(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : 0;
  const progressPercent = progress
    ? Math.min(
        100,
        Math.round((progress.processed / Math.max(progress.total, 1)) * 100),
      )
    : 0;
  const importDisabled =
    importing ||
    activeImportRunning ||
    statsLoading ||
    !stats ||
    stats.remaining === 0 ||
    quantity.trim() === "" ||
    quantityValue < 1 ||
    quantityValue > stats.remaining;
  const statsMessage = useMemo(() => {
    if (!selectedStore) {
      return "Select a store to load eBay listing stats.";
    }

    if (statsLoading) {
      return "Loading eBay listing stats...";
    }

    if (statsError) {
      return statsError;
    }

    if (!stats) {
      return "Listing stats are not loaded yet.";
    }

    if (stats.activeListings === 0) {
      return "No active listings found on this store.";
    }

    return `${stats.storeName} has ${formatNumber(stats.activeListings)} active eBay listings - ${formatNumber(stats.alreadyImported)} already in ListFlow - ${formatNumber(stats.remaining)} remaining`;
  }, [selectedStore, stats, statsError, statsLoading]);

  const loadStats = useCallback(async (forceRefresh = false) => {
    if (!selectedStore) {
      setStats(null);
      return;
    }

    setStatsLoading(true);
    setStatsRefreshing(forceRefresh);
    setStatsError(null);

    try {
      const params = new URLSearchParams({ storeId: selectedStore });

      if (forceRefresh) {
        params.set("refresh", "1");
      }

      const response = await fetch(
        `/api/ebay-import?${params.toString()}`,
      );
      const data = (await response.json().catch(() => ({}))) as
        | ImportStats
        | { error?: string };

      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Failed to load eBay stats");
      }

      const nextStats = data as ImportStats;
      setStats(nextStats);
      setQuantity(nextStats.remaining > 0 ? String(Math.min(100, nextStats.remaining)) : "0");
      setQuantityNotice(null);
    } catch (caughtError) {
      setStats(null);
      setStatsError(getErrorMessage(caughtError));
    } finally {
      setStatsLoading(false);
      setStatsRefreshing(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  function handleQuantityChange(value: string) {
    if (value.trim() === "") {
      setQuantity("");
      setQuantityNotice(null);
      return;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      setQuantity("");
      setQuantityNotice(null);
      return;
    }

    const normalized = Math.max(0, parsed);

    if (stats && normalized > stats.remaining) {
      setQuantity(String(stats.remaining));
      setQuantityNotice(
        `Only ${formatNumber(stats.remaining)} listings remain - importing ${formatNumber(stats.remaining)}`,
      );
      return;
    }

    setQuantity(String(normalized));
    setQuantityNotice(null);
  }

  function openConfirmation(amount = quantityValue) {
    if (!stats || amount < 1 || amount > stats.remaining || importing || activeImportRunning) {
      return;
    }

    setPendingQuantity(amount);
    setProgress(null);
    setResult(null);
    setError(null);
    setShowErrors(false);
    setModalState("confirm");
  }

  function handleImportAllRemaining() {
    if (!stats || stats.remaining < 1 || importing || activeImportRunning) {
      return;
    }

    setQuantity(String(stats.remaining));
    setQuantityNotice(null);
    openConfirmation(stats.remaining);
  }

  async function removeStaleProducts() {
    if (!stats || stats.staleInListFlow < 1 || staleRemoving || activeImportRunning) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${formatNumber(stats.staleInListFlow)} ListFlow product(s) that are no longer active on eBay? This does not end or revise anything on eBay.`,
    );

    if (!confirmed) {
      return;
    }

    setStaleRemoving(true);
    setStatsError(null);

    try {
      const response = await fetch("/api/ebay-import/stale", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        deleted?: number;
        stats?: ImportStats;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to remove stale ListFlow products");
      }

      if (data.stats) {
        setStats(data.stats);
        setQuantity(data.stats.remaining > 0 ? String(Math.min(100, data.stats.remaining)) : "0");
      } else {
        await loadStats(true);
      }

      router.refresh();
    } catch (caughtError) {
      setStatsError(getErrorMessage(caughtError));
    } finally {
      setStaleRemoving(false);
    }
  }

  const applyImportJob = useCallback(
    (job: ImportJob) => {
      setActiveJob(job);
      setPendingQuantity(job.quantity);

      if (isActiveImportJob(job)) {
        writeStoredImportJob(job);
        setImporting(true);
        setModalState("importing");
        setProgress({
          processed: job.processed,
          total: job.total || job.requested || job.quantity,
          created: job.created,
          skipped: job.skipped,
          failed: job.failed,
        });
        setResult(null);
        setError(null);
        return;
      }

      clearStoredImportJob(job.id);
      setActiveJob(null);
      setImporting(false);
      setProgress(null);
      setModalState("complete");

      if (job.status === "FAILED") {
        setResult(null);
        setError(job.errorMessage || "eBay import failed");
      } else {
        setError(null);
        setResult({
          requested: job.requested,
          activeListings: job.activeListings,
          alreadyImported: job.alreadyImported,
          remainingBeforeImport: job.remainingBeforeImport,
          remainingAfterImport: job.remainingAfterImport,
          created: job.created,
          skipped: job.skipped,
          failed: job.failed,
          rateLimited: job.rateLimited,
          errors: job.errors,
        });
      }

      router.refresh();
      void loadStats();
    },
    [loadStats, router],
  );

  const fetchImportJob = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/ebay-import/jobs/${encodeURIComponent(jobId)}`,
      { cache: "no-store" },
    );
    const data = (await response.json().catch(() => ({}))) as {
      job?: ImportJob;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load import job");
    }

    return data.job ?? null;
  }, []);

  async function startImport() {
    if (!selectedStore || importing || activeImportRunning || pendingQuantity < 1) {
      return;
    }

    setImporting(true);
    setModalState("importing");
    setProgress({
      processed: 0,
      total: pendingQuantity,
      created: 0,
      skipped: 0,
      failed: 0,
    });
    setResult(null);
    setError(null);
    setShowErrors(false);

    try {
      const response = await fetch("/api/ebay-import/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore, quantity: pendingQuantity }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        job?: ImportJob;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to start eBay import");
      }

      if (!data.job) {
        throw new Error("Import job response did not include a job");
      }

      applyImportJob(data.job);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setProgress(null);
      setModalState("complete");
      setImporting(false);
    }
  }

  useEffect(() => {
    if (!selectedStore) {
      return;
    }

    let cancelled = false;

    async function recoverImportJob() {
      const stored = readStoredImportJob();

      if (stored?.storeId === selectedStore) {
        try {
          const job = await fetchImportJob(stored.id);

          if (!cancelled && job) {
            applyImportJob(job);
            return;
          }
        } catch {
          clearStoredImportJob(stored.id);
        }
      }

      try {
        const response = await fetch(
          `/api/ebay-import/jobs/current?storeId=${encodeURIComponent(selectedStore)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => ({}))) as {
          job?: ImportJob | null;
        };

        if (!cancelled && response.ok && data.job) {
          applyImportJob(data.job);
        }
      } catch {
        if (!cancelled && stored?.storeId === selectedStore) {
          clearStoredImportJob(stored.id);
        }
      }
    }

    void recoverImportJob();

    return () => {
      cancelled = true;
    };
  }, [applyImportJob, fetchImportJob, selectedStore]);

  useEffect(() => {
    if (!activeJobId || !activeImportRunning) {
      return;
    }

    const jobId = activeJobId;
    let cancelled = false;

    async function pollImportJob() {
      try {
        const job = await fetchImportJob(jobId);

        if (!cancelled && job) {
          applyImportJob(job);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError));
          setImporting(false);
          setProgress(null);
          setModalState("complete");
        }
      }
    }

    const intervalId = window.setInterval(pollImportJob, 2000);
    void pollImportJob();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeImportRunning, activeJobId, applyImportJob, fetchImportJob]);

  function closeModal() {
    if (importing) {
      return;
    }

    setModalState(null);
    setProgress(null);
    setResult(null);
    setError(null);
  }

  function resetForNextBatch() {
    setActiveJob(null);
    setModalState(null);
    setProgress(null);
    setResult(null);
    setError(null);
    setShowErrors(false);
    void loadStats();
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Import eBay Listings</h1>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div>
            <label htmlFor="store" className="block text-sm font-medium text-gray-700">
              Store
            </label>
            <select
              id="store"
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
              disabled={importing || activeImportRunning || stores.length === 0}
              className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
            >
              {stores.length === 0 ? (
                <option value="">No active stores</option>
              ) : (
                stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min={0}
              max={stats?.remaining ?? undefined}
              value={quantity}
              onChange={(event) => handleQuantityChange(event.target.value)}
              disabled={importing || activeImportRunning || statsLoading || !stats}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
        </div>

        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            statsError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-orange-200 bg-orange-50 text-orange-900"
          }`}
          aria-live="polite"
        >
          {statsMessage}
        </div>

        <div className="mt-2 text-xs text-gray-500">
          {quantityNotice || "Duplicates are skipped automatically"}
        </div>

        {stats && stats.staleInListFlow > 0 && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {formatNumber(stats.staleInListFlow)} ListFlow product{stats.staleInListFlow === 1 ? "" : "s"} are no longer active on eBay.
              </span>
              <button
                type="button"
                onClick={removeStaleProducts}
                disabled={staleRemoving || activeImportRunning}
                className="inline-flex items-center justify-center rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {staleRemoving ? "Removing..." : "Remove stale from ListFlow"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void loadStats(true)}
            disabled={statsLoading || importing || activeImportRunning}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {statsRefreshing ? "Refreshing..." : "Refresh eBay Count"}
          </button>
          <button
            type="button"
            onClick={() => openConfirmation()}
            disabled={importDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0 4-4m-4 4-4-4m-3 8h14" />
            </svg>
            Import Batch
          </button>
          <button
            type="button"
            onClick={handleImportAllRemaining}
            disabled={importing || activeImportRunning || statsLoading || !stats || stats.remaining < 1}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import All Remaining
          </button>
        </div>
      </section>

      {modalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 py-6">
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
            {modalState === "confirm" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Confirm Import</h2>
                <dl className="mt-5 grid gap-4 rounded-md border border-gray-200 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-gray-500">Store</dt>
                    <dd className="mt-1 text-gray-900">
                      {selectedStoreRecord?.name ?? stats?.storeName ?? "Selected store"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-500">Quantity</dt>
                    <dd className="mt-1 text-gray-900">{formatNumber(pendingQuantity)}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-sm text-gray-600">
                  Products already in ListFlow will be skipped automatically.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={startImport}
                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}

            {modalState === "importing" && (
              <div className="p-6" aria-live="polite">
                <h2 className="text-lg font-semibold text-gray-900">
                  {activeJobStatus === "QUEUED" ? "Preparing Import" : "Importing Listings"}
                </h2>
                <div className="mt-5 flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-gray-900">
                    {activeJobStatus === "QUEUED" && (progress?.processed ?? 0) === 0
                      ? "Waiting to start..."
                      : `Importing ${progress?.processed ?? 0} of ${progress?.total ?? pendingQuantity}...`}
                  </p>
                  <span className="text-sm text-gray-500">{progressPercent}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progress?.currentItemId && (
                  <p className="mt-3 truncate font-mono text-xs text-gray-500">
                    {progress.currentItemId}
                  </p>
                )}
                <div className="mt-5 grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
                  <span>Imported: {progress?.created ?? 0}</span>
                  <span>Skipped: {progress?.skipped ?? 0}</span>
                  <span>Failed: {progress?.failed ?? 0}</span>
                </div>
              </div>
            )}

            {modalState === "complete" && (
              <div className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {error ? "Import Failed" : result?.rateLimited ? "Import Paused" : "Import Complete"}
                  </h2>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded p-1 text-gray-400 transition-colors hover:text-gray-700"
                    aria-label="Close"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {result && (
                  <>
                    {result.created === 0 && result.skipped > 0 && result.failed === 0 && (
                      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        This batch was all duplicates - run again to fetch the next set.
                      </div>
                    )}

                    {result.rateLimited && (
                      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        eBay rate limit was reached. Saved products are intact; retry later to continue.
                      </div>
                    )}

                    <dl className="mt-5 grid overflow-hidden rounded-md border border-gray-200 sm:grid-cols-5 sm:divide-x sm:divide-gray-200">
                      {[
                        ["Requested", result.requested],
                        ["Imported", result.created],
                        ["Skipped", result.skipped],
                        ["Failed", result.failed],
                        ["Remaining", result.remainingAfterImport],
                      ].map(([label, value]) => (
                        <div key={label} className="px-4 py-3">
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            {label}
                          </dt>
                          <dd className="mt-1 text-2xl font-semibold text-gray-900">
                            {formatNumber(Number(value))}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {result.failed > 0 && (
                      <div className="mt-5">
                        <button
                          type="button"
                          onClick={() => setShowErrors((current) => !current)}
                          className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                          <svg
                            className={`h-4 w-4 transition-transform ${showErrors ? "rotate-90" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          Failed listings ({result.failed})
                        </button>

                        {showErrors && (
                          <div className="mt-3 overflow-hidden rounded-md border border-gray-200">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                                <tr>
                                  <th className="px-4 py-3">Item ID</th>
                                  <th className="px-4 py-3">Title</th>
                                  <th className="px-4 py-3">Error</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {result.errors.map((row) => (
                                  <tr key={`${row.itemId}-${row.title}-${row.error}`}>
                                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                                      {row.itemId}
                                    </td>
                                    <td className="max-w-xs px-4 py-3 text-gray-700">
                                      <span className="block truncate" title={row.title}>
                                        {row.title}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-red-700">{row.error}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  {result && (
                    <Link
                      href="/products?imported=today"
                      className="inline-flex items-center rounded-md border border-orange-500 px-4 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50"
                    >
                      View Imported Products
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={resetForNextBatch}
                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
                  >
                    {error ? "Try Again" : "Import Next Batch"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
