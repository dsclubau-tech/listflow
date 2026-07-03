"use client";

import { useCallback, useEffect, useState } from "react";

type ProductStatusKey = "DRAFT" | "FAILED" | "IMPORTED" | "ON_HOLD";

interface RemovalSnapshot {
  storeName: string;
  storeLoginId: string;
  confirmationPhrase: string;
  total: number;
  counts: Record<ProductStatusKey, number>;
  activeJobs: {
    priceCheck: number;
    ebayImport: number;
  };
  activeJobsVerified?: boolean;
  activeJobsWarning?: string | null;
  isBlocked: boolean;
}

interface RemovalResult {
  deletedProducts: number;
  deletedVariants: number;
  deletedPriceHistory: number;
  deletedUploadLogs: number;
  deletedEbayImportStatsCache: number;
}

const statusLabels: Record<ProductStatusKey, string> = {
  DRAFT: "Drafts",
  FAILED: "Failed",
  IMPORTED: "Imported",
  ON_HOLD: "On hold",
};

const statusOrder: ProductStatusKey[] = [
  "DRAFT",
  "FAILED",
  "IMPORTED",
  "ON_HOLD",
];

export default function DangerZoneTab() {
  const [snapshot, setSnapshot] = useState<RemovalSnapshot | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemovalResult | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/products/remove-all", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Failed to load removal summary");
        return;
      }

      setSnapshot(data as RemovalSnapshot);
    } catch {
      setError("Network error while loading removal summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  async function handleRemoveAll() {
    if (!snapshot || confirmationInput !== snapshot.confirmationPhrase) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${snapshot.total} listing(s) from ListFlow for ${snapshot.storeName}?\n\nThis will NOT end or revise any live eBay listings.`,
    );

    if (!confirmed) {
      return;
    }

    setRemoving(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/products/remove-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationPhrase: confirmationInput,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Failed to remove listings from ListFlow");
        if (response.status === 409 && data) {
          setSnapshot(data as RemovalSnapshot);
        }
        return;
      }

      setResult(data as RemovalResult);
      setConfirmationInput("");
      await fetchSnapshot();
    } catch {
      setError("Network error while removing listings");
    } finally {
      setRemoving(false);
    }
  }

  const confirmationPhrase = snapshot?.confirmationPhrase ?? "";
  const canRemove = snapshot
    ? !loading &&
      !removing &&
      !snapshot.isBlocked &&
      snapshot.total > 0 &&
      confirmationInput === confirmationPhrase
    : false;

  if (loading && !snapshot) {
    return <p className="text-sm text-gray-500">Loading danger zone...</p>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-lg border border-red-200 bg-white">
        <div className="border-b border-red-100 bg-red-50 px-5 py-4">
          <h2 className="text-base font-semibold text-red-800">
            Remove all listings from ListFlow
          </h2>
          <p className="mt-1 text-sm text-red-700">
            This removes product records from ListFlow for the current store only.
            Live eBay listings will remain active and unchanged.
          </p>
        </div>

        <div className="space-y-5 px-5 py-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              Removed {result.deletedProducts} listing(s), {result.deletedVariants} variant(s),
              {` ${result.deletedPriceHistory}`} price history record(s), and
              {` ${result.deletedUploadLogs}`} upload log(s) from ListFlow.
            </div>
          )}

          {snapshot && (
            <>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Current store: {snapshot.storeName}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Store ID: {snapshot.storeLoginId}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {statusOrder.map((status) => (
                  <div
                    key={status}
                    className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {statusLabels[status]}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-gray-900">
                      {snapshot.counts[status] ?? 0}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Total ListFlow listings
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {snapshot.total} product record(s) will be removed from this store.
                    </p>
                  </div>
                  <span className="text-2xl font-semibold text-gray-900">
                    {snapshot.total}
                  </span>
                </div>
              </div>

              {snapshot.activeJobsWarning && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {snapshot.activeJobsWarning}
                </div>
              )}

              {snapshot.isBlocked && !snapshot.activeJobsWarning && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Stop or wait for active jobs before removing listings.
                  Active price-check jobs: {snapshot.activeJobs.priceCheck}. Active eBay import jobs: {snapshot.activeJobs.ebayImport}.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Type <code className="rounded bg-gray-100 px-1 py-0.5">{confirmationPhrase}</code> to enable removal
                </label>
                <input
                  type="text"
                  value={confirmationInput}
                  onChange={(event) => setConfirmationInput(event.target.value)}
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder={confirmationPhrase}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => void fetchSnapshot()}
                  disabled={loading || removing}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  Refresh counts
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveAll()}
                  disabled={!canRemove}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {removing ? "Removing..." : "Remove all from ListFlow"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
