"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";

interface PriceTrackerSummary {
  trackedCount: number;
  changedToday: number;
  failedChecks: number;
  lastRunAt: string | null;
}

interface PriceTrackerHistoryItem {
  id: string;
  productId: string;
  variantId: string | null;
  previousPrice: string;
  newPrice: string;
  previousSellPrice: string;
  newSellPrice: string;
  changePercent: number;
  ebayRevised: boolean;
  errorMessage: string | null;
  source: "LIVE" | "SIMULATED";
  appliedAt: string | null;
  createdAt: string;
  product: {
    id: string;
    title: string;
    asin: string | null;
    ebayItemId: string | null;
  };
  variant: {
    id: string;
    title: string;
  } | null;
}

interface TrackedProductOption {
  id: string;
  title: string;
  asin: string | null;
  amazonPrice: string | null;
  ebayItemId: string | null;
  buyPrice: string;
  sellPrice: string;
}

interface PriceTrackerClientProps {
  initialSummary: PriceTrackerSummary;
  initialHistory: PriceTrackerHistoryItem[];
  initialTrackedProducts: TrackedProductOption[];
}

interface PriceCheckResponse {
  checked?: number;
  changed?: number;
  pendingReview?: number;
  failed?: number;
  skipped?: number;
  reason?: string;
  error?: string;
}

interface BulkResolution {
  matched: { asin: string; productId: string; title: string }[];
  unmatched: string[];
}

interface BulkCheckResult {
  summary: string;
  resolution: BulkResolution | null;
  tone: "success" | "warning" | "error";
}

interface SimulationResultState {
  summary: string;
  detail: string;
  tone: "success" | "warning" | "error";
}

type SourceFilter = "all" | "live" | "simulated";
type DirectionFilter = "all" | "up" | "down";
type SortValue = "newest" | "largest" | "smallest";

function formatMoney(value: string | number) {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  return `A$${amount.toFixed(2)}`;
}

function formatMoneyInput(value: string | number | null) {
  if (value === null) {
    return "";
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPriceCheckSummary(data: PriceCheckResponse) {
  if (data.reason) {
    return data.reason;
  }

  return `${data.checked ?? 0} checked, ${data.pendingReview ?? 0} pending review, ${data.failed ?? 0} failed, ${data.skipped ?? 0} skipped.`;
}

function getSimulationTone(data: PriceCheckResponse): SimulationResultState["tone"] {
  if ((data.failed ?? 0) > 0) {
    return "error";
  }

  if ((data.changed ?? 0) > 0) {
    return "success";
  }

  return "warning";
}

function getHistoryStatus(item: PriceTrackerHistoryItem) {
  if (!item.appliedAt) {
    return {
      label: "Pending review",
      classes: "bg-amber-100 text-amber-800",
    };
  }

  if (item.ebayRevised) {
    return {
      label: "Revised",
      classes: "bg-emerald-100 text-emerald-700",
    };
  }

  if (item.errorMessage) {
    return {
      label: "Apply failed",
      classes: "bg-red-100 text-red-700",
    };
  }

  return {
    label: "Dismissed",
    classes: "bg-gray-100 text-gray-700",
  };
}

export default function PriceTrackerClient({
  initialSummary,
  initialHistory,
  initialTrackedProducts,
}: PriceTrackerClientProps) {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const [isChecking, setIsChecking] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilter>("all");
  const [sortBy, setSortBy] = useState<SortValue>("newest");
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [simulatedPrice, setSimulatedPrice] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] =
    useState<SimulationResultState | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [asinInput, setAsinInput] = useState("");
  const [isBulkChecking, setIsBulkChecking] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkCheckResult | null>(null);
  const [reviewingHistoryId, setReviewingHistoryId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!isChecking) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [isChecking, router]);

  useEffect(() => {
    if (initialTrackedProducts.length === 0) {
      if (selectedProductId) {
        setSelectedProductId("");
      }
      return;
    }

    const stillExists = initialTrackedProducts.some(
      (product) => product.id === selectedProductId
    );

    if (!selectedProductId || !stillExists) {
      setSelectedProductId(initialTrackedProducts[0].id);
    }
  }, [initialTrackedProducts, selectedProductId]);

  useEffect(() => {
    const selectedProduct = initialTrackedProducts.find(
      (product) => product.id === selectedProductId
    );

    setSimulatedPrice(formatMoneyInput(selectedProduct?.amazonPrice ?? null));
  }, [initialTrackedProducts, selectedProductId]);

  useEffect(() => {
    setSimulationResult(null);
  }, [selectedProductId]);

  const filteredHistory = useMemo(() => {
    const sourceFiltered = initialHistory.filter((item) => {
      if (sourceFilter === "all") {
        return true;
      }

      return sourceFilter === "live"
        ? item.source === "LIVE"
        : item.source === "SIMULATED";
    });

    const directionFiltered = sourceFiltered.filter((item) => {
      if (directionFilter === "all") {
        return true;
      }

      const isUp = Number(item.changePercent) > 0;
      return directionFilter === "up" ? isUp : !isUp;
    });

    const items = [...directionFiltered];

    items.sort((left, right) => {
      if (sortBy === "largest") {
        return Math.abs(right.changePercent) - Math.abs(left.changePercent);
      }

      if (sortBy === "smallest") {
        return Math.abs(left.changePercent) - Math.abs(right.changePercent);
      }

      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    });

    return items;
  }, [directionFilter, initialHistory, sortBy, sourceFilter]);

  const selectedProduct = useMemo(
    () =>
      initialTrackedProducts.find((product) => product.id === selectedProductId) ??
      null,
    [initialTrackedProducts, selectedProductId]
  );

  const currentAmazonPrice = selectedProduct?.amazonPrice
    ? Number(selectedProduct.amazonPrice)
    : null;
  const hasStoredAmazonPrice =
    currentAmazonPrice !== null &&
    Number.isFinite(currentAmazonPrice) &&
    currentAmazonPrice > 0;
  const parsedSimulatedPrice = Number(simulatedPrice);
  const canRunSimulation =
    Boolean(selectedProduct) &&
    Number.isFinite(parsedSimulatedPrice) &&
    parsedSimulatedPrice > 0 &&
    !isSimulating;

  const handleCheckNow = async () => {
    setIsChecking(true);

    try {
      const response = await fetch("/api/price-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ all: true }),
      });

      const data = (await response.json()) as PriceCheckResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to check prices");
      }

      showToast(
        data.reason
          ? data.reason
          : `Checked ${data.checked ?? 0} products. ${data.pendingReview ?? 0} pending review, ${data.failed ?? 0} failed, ${data.skipped ?? 0} unchanged.`,
        data.failed && data.failed > 0 ? "error" : "success"
      );
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to check prices";
      showToast(message, "error");
    } finally {
      setIsChecking(false);
    }
  };

  const applyQuickAdjustment = (multiplier: number) => {
    if (!hasStoredAmazonPrice || currentAmazonPrice === null) {
      return;
    }

    setSimulatedPrice(formatMoneyInput(currentAmazonPrice * multiplier));
  };

  const handleSimulatedCheck = async () => {
    if (!selectedProduct) {
      showToast("Select a tracked product first.", "error");
      return;
    }

    if (!Number.isFinite(parsedSimulatedPrice) || parsedSimulatedPrice <= 0) {
      showToast("Enter a valid simulated price.", "error");
      return;
    }

    setIsSimulating(true);
    setSimulationResult(null);

    try {
      const response = await fetch("/api/price-check/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: selectedProduct.id,
          simulatedPrice: parsedSimulatedPrice,
        }),
      });

      const data = (await response.json()) as PriceCheckResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to run simulated check");
      }

      const summary = formatPriceCheckSummary(data);
      const tone = getSimulationTone(data);
      let detail =
        "The simulation completed without a recorded price change.";

      if (tone === "error") {
        detail =
          "The simulated run did not complete cleanly. Check the latest history entry or product error state for details.";
      } else if ((data.changed ?? 0) > 0) {
        detail =
          "The simulated change was recorded for manual review. Variant prices and the eBay listing were not changed.";
      } else if (data.reason?.startsWith("Baseline established")) {
        detail =
          "The simulated price was stored as the Amazon baseline. Run again with a different price to exercise the change flow.";
      } else if ((data.skipped ?? 0) > 0) {
        detail =
          "No update was applied because the simulated price did not produce a change that passed the tracker rules.";
      }

      setSimulationResult({
        summary,
        detail,
        tone,
      });
      showToast(summary, tone === "error" ? "error" : "success");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to run simulated check";

      setSimulationResult({
        summary: message,
        detail: "The simulator request was rejected before a price update was recorded.",
        tone: "error",
      });
      showToast(message, "error");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleHistoryReview = async (
    priceHistoryId: string,
    action: "apply" | "dismiss"
  ) => {
    if (action === "apply") {
      const confirmed = window.confirm(
        "Apply this price change to local variants and revise the eBay listing?"
      );

      if (!confirmed) {
        return;
      }
    }

    setReviewingHistoryId(priceHistoryId);

    try {
      const response = await fetch(`/api/price-check/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceHistoryId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        applied?: number;
        dismissed?: number;
      };

      if (!response.ok) {
        showToast(data.error || "Failed to review price change.", "error");
        router.refresh();
        return;
      }

      showToast(
        action === "apply"
          ? `Applied ${data.applied ?? 0} price change(s).`
          : `Dismissed ${data.dismissed ?? 0} price change(s).`,
        "success"
      );
      router.refresh();
    } catch {
      showToast("Network error while reviewing price change.", "error");
    } finally {
      setReviewingHistoryId(null);
    }
  };

  const simulationResultClasses =
    simulationResult?.tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : simulationResult?.tone === "warning"
        ? "border-amber-200 bg-amber-100/70 text-amber-950"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Price Tracker</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor Amazon buy-price changes and review them before revising
            eBay listings.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCheckNow}
          disabled={isChecking}
          className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m14.356-2A8 8 0 006.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 017.64 15m11.778 0H15"
            />
          </svg>
          {isChecking ? "Checking..." : "Check Prices Now"}
        </button>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Total Tracked
          </p>
          <p className="mt-3 text-3xl font-semibold text-gray-900">
            {initialSummary.trackedCount}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Changed Today
          </p>
          <p className="mt-3 text-3xl font-semibold text-emerald-900">
            {initialSummary.changedToday}
          </p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-red-700">
            Failed Checks
          </p>
          <p className="mt-3 text-3xl font-semibold text-red-900">
            {initialSummary.failedChecks}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Last Run
          </p>
          <p className="mt-3 text-lg font-semibold text-gray-900">
            {formatDateTime(initialSummary.lastRunAt)}
          </p>
        </div>
      </div>

      <div className="mb-8 overflow-hidden rounded-2xl border border-dashed border-amber-300 bg-amber-50/70">
        <button
          type="button"
          onClick={() => setIsSimulatorOpen((current) => !current)}
          aria-expanded={isSimulatorOpen}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Test
              </span>
              <h2 className="text-lg font-semibold text-amber-950">
                Test Simulator
              </h2>
            </div>
            <p className="mt-1 text-sm text-amber-900/80">
              Simulate an Amazon price change for one tracked product and verify
              the manual review flow immediately.
            </p>
          </div>

          <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-900">
            {isSimulatorOpen ? "Hide" : "Show"}
            <svg
              className={`h-4 w-4 transition-transform ${
                isSimulatorOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m6 9 6 6 6-6"
              />
            </svg>
          </span>
        </button>

        {isSimulatorOpen && (
          <div className="border-t border-amber-200 px-5 py-5">
            {initialTrackedProducts.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-950">
                No tracked products are ready for simulation yet.
              </p>
            ) : (
              <>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                  <div className="rounded-xl border border-amber-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-900">
                      Product Picker
                    </label>
                    <select
                      value={selectedProductId}
                      onChange={(event) => setSelectedProductId(event.target.value)}
                      className="mt-2 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {initialTrackedProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.title} ({product.asin ?? "No ASIN"})
                        </option>
                      ))}
                    </select>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          Current Amazon Price
                        </p>
                        <p className="mt-2 text-lg font-semibold text-gray-900">
                          {selectedProduct?.amazonPrice
                            ? formatMoney(selectedProduct.amazonPrice)
                            : "Not stored"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          First Variant Buy
                        </p>
                        <p className="mt-2 text-lg font-semibold text-gray-900">
                          {selectedProduct
                            ? formatMoney(selectedProduct.buyPrice)
                            : "A$0.00"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          First Variant Sell
                        </p>
                        <p className="mt-2 text-lg font-semibold text-gray-900">
                          {selectedProduct
                            ? formatMoney(selectedProduct.sellPrice)
                            : "A$0.00"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">ASIN:</span>{" "}
                      {selectedProduct?.asin ?? "Not available"}
                      <span className="mx-2 text-gray-300">|</span>
                      <span className="font-medium text-gray-700">eBay:</span>{" "}
                      {selectedProduct?.ebayItemId ?? "Not linked"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-900">
                      Simulated Price
                    </label>
                    <div className="mt-2 flex items-center rounded-md border border-amber-200 bg-white focus-within:ring-2 focus-within:ring-amber-500">
                      <span className="px-3 text-sm text-gray-500">A$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={simulatedPrice}
                        onChange={(event) => setSimulatedPrice(event.target.value)}
                        className="w-full rounded-r-md px-3 py-2 text-sm text-gray-900 focus:outline-none"
                        placeholder="45.99"
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => applyQuickAdjustment(1.1)}
                        disabled={!hasStoredAmazonPrice}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +10%
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickAdjustment(0.9)}
                        disabled={!hasStoredAmazonPrice}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        -10%
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickAdjustment(1.25)}
                        disabled={!hasStoredAmazonPrice}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +25%
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickAdjustment(0.75)}
                        disabled={!hasStoredAmazonPrice}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        -25%
                      </button>
                    </div>

                    {!hasStoredAmazonPrice && (
                      <p className="mt-3 text-xs text-amber-900">
                        No baseline stored yet. The first simulated run will establish
                        the baseline. Run again with a different price to test changes.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleSimulatedCheck}
                      disabled={!canRunSimulation}
                      className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSimulating ? "Running..." : "Run Simulated Check"}
                    </button>
                  </div>
                </div>

                {simulationResult && (
                  <div
                    className={`mt-4 rounded-xl border px-4 py-3 ${simulationResultClasses}`}
                  >
                    <p className="text-sm font-semibold">Simulation Result</p>
                    <p className="mt-1 text-sm">{simulationResult.summary}</p>
                    <p className="mt-1 text-xs opacity-90">
                      {simulationResult.detail}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-8 overflow-hidden rounded-2xl border border-dashed border-sky-300 bg-sky-50/70">
        <button
          type="button"
          onClick={() => setIsBulkOpen((current) => !current)}
          aria-expanded={isBulkOpen}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex rounded-full border border-sky-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                Bulk
              </span>
              <h2 className="text-lg font-semibold text-sky-950">
                Bulk ASIN Check
              </h2>
            </div>
            <p className="mt-1 text-sm text-sky-900/80">
              Paste a list of ASINs to run targeted price checks on specific
              products.
            </p>
          </div>

          <span className="inline-flex items-center gap-2 text-sm font-medium text-sky-900">
            {isBulkOpen ? "Hide" : "Show"}
            <svg
              className={`h-4 w-4 transition-transform ${
                isBulkOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m6 9 6 6 6-6"
              />
            </svg>
          </span>
        </button>

        {isBulkOpen && (
          <div className="border-t border-sky-200 px-5 py-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-xl border border-sky-200 bg-white p-4">
                <label className="block text-sm font-medium text-gray-900">
                  ASIN List
                </label>
                <textarea
                  value={asinInput}
                  onChange={(event) => {
                    setAsinInput(event.target.value);
                    setBulkResult(null);
                  }}
                  rows={6}
                  placeholder={"Paste ASINs here — one per line, or comma/space separated\nB0D36TKRB1\nB0DNZCQQJJ\nB0CX23V2ZK"}
                  className="mt-2 w-full rounded-md border border-sky-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="mt-2 text-xs text-gray-500">
                  {(() => {
                    const parsed = asinInput
                      .split(/[\n,\s]+/)
                      .map((s) => s.trim().toUpperCase())
                      .filter(Boolean);
                    const unique = [...new Set(parsed)];
                    return unique.length === 0
                      ? "No ASINs entered yet."
                      : `${unique.length} unique ASIN${unique.length === 1 ? "" : "s"} detected.`;
                  })()}
                </p>
              </div>

              <div className="rounded-xl border border-sky-200 bg-white p-4">
                <p className="text-sm font-medium text-gray-900">How it works</p>
                <ul className="mt-2 space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-sky-600">1.</span>
                    Paste your ASINs in the box — any format works.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-sky-600">2.</span>
                    We match each ASIN against your imported products.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-sky-600">3.</span>
                    A live Amazon price check runs only on matched products.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-sky-600">4.</span>
                    Detected changes will be shown for your review.
                  </li>
                </ul>

                <button
                  type="button"
                  onClick={async () => {
                    const parsed = asinInput
                      .split(/[\n,\s]+/)
                      .map((s) => s.trim().toUpperCase())
                      .filter(Boolean);
                    const unique = [...new Set(parsed)];

                    if (unique.length === 0) {
                      showToast("Enter at least one ASIN.", "error");
                      return;
                    }

                    setIsBulkChecking(true);
                    setBulkResult(null);

                    try {
                      const response = await fetch("/api/price-check", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ asins: unique }),
                      });

                      const data = (await response.json()) as PriceCheckResponse & {
                        resolution?: BulkResolution;
                      };

                      if (!response.ok) {
                        throw new Error(data.error || "Bulk check failed");
                      }

                      const matchedCount = data.resolution?.matched.length ?? 0;
                      const unmatchedCount = data.resolution?.unmatched.length ?? 0;

                      const tone: BulkCheckResult["tone"] =
                        (data.failed ?? 0) > 0
                          ? "error"
                          : unmatchedCount > 0
                            ? "warning"
                            : "success";

                      setBulkResult({
                        summary: formatPriceCheckSummary(data),
                        resolution: data.resolution ?? null,
                        tone,
                      });

                      showToast(
                        `Checked ${matchedCount} product${matchedCount === 1 ? "" : "s"}. ${unmatchedCount} ASIN${unmatchedCount === 1 ? "" : "s"} unmatched.`,
                        tone === "error" ? "error" : "success"
                      );

                      router.refresh();
                    } catch (error) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Bulk price check failed";
                      showToast(message, "error");
                      setBulkResult({
                        summary: message,
                        resolution: null,
                        tone: "error",
                      });
                    } finally {
                      setIsBulkChecking(false);
                    }
                  }}
                  disabled={
                    isBulkChecking ||
                    asinInput
                      .split(/[\n,\s]+/)
                      .filter((s) => s.trim()).length === 0
                  }
                  className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBulkChecking ? "Checking..." : "Check These ASINs"}
                </button>
              </div>
            </div>

            {bulkResult && (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 ${
                  bulkResult.tone === "error"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : bulkResult.tone === "warning"
                      ? "border-amber-200 bg-amber-100/70 text-amber-950"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                <p className="text-sm font-semibold">Bulk Check Result</p>
                <p className="mt-1 text-sm">{bulkResult.summary}</p>

                {bulkResult.resolution && (
                  <div className="mt-3 space-y-2">
                    {bulkResult.resolution.matched.length > 0 && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                          Matched ({bulkResult.resolution.matched.length})
                        </p>
                        <ul className="mt-1 space-y-1">
                          {bulkResult.resolution.matched.map((m) => (
                            <li
                              key={m.asin}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-xs text-emerald-800">
                                ✓
                              </span>
                              <span className="font-mono text-xs">
                                {m.asin}
                              </span>
                              <span className="truncate text-xs opacity-80">
                                — {m.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {bulkResult.resolution.unmatched.length > 0 && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                          Unmatched ({bulkResult.resolution.unmatched.length})
                        </p>
                        <ul className="mt-1 space-y-1">
                          {bulkResult.resolution.unmatched.map((asin) => (
                            <li
                              key={asin}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-200 text-xs text-red-800">
                                ✗
                              </span>
                              <span className="font-mono text-xs">
                                {asin}
                              </span>
                              <span className="text-xs opacity-70">
                                — not imported or no variants
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={sourceFilter}
          onChange={(event) =>
            setSourceFilter(event.target.value as SourceFilter)
          }
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="all">All sources</option>
          <option value="live">Live only</option>
          <option value="simulated">Simulated only</option>
        </select>

        <select
          value={directionFilter}
          onChange={(event) =>
            setDirectionFilter(event.target.value as DirectionFilter)
          }
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="all">All directions</option>
          <option value="up">Price up</option>
          <option value="down">Price down</option>
        </select>

        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortValue)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="newest">Newest first</option>
          <option value="largest">Largest change</option>
          <option value="smallest">Smallest change</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Amazon</th>
              <th className="px-4 py-3">eBay</th>
              <th className="px-4 py-3">% Change</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Time</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-gray-500"
                >
                  No price history matches the current filters.
                </td>
              </tr>
            ) : (
              filteredHistory.map((item) => {
                const priceWentUp = item.changePercent > 0;
                const sourceLabel = item.source === "SIMULATED" ? "SIM" : "LIVE";
                const sourceClasses =
                  item.source === "SIMULATED"
                    ? "border-amber-200 bg-amber-100 text-amber-800"
                    : "border-emerald-200 bg-emerald-100 text-emerald-700";
                const historyStatus = getHistoryStatus(item);
                const isPendingReview = !item.appliedAt;

                return (
                  <tr
                    key={item.id}
                    className={`border-b last:border-b-0 ${
                      priceWentUp ? "bg-red-50/40" : "bg-emerald-50/40"
                    }`}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">
                        {item.product.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {item.product.asin && (
                          <a
                            href={`https://www.amazon.com.au/dp/${item.product.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-orange-600 transition-colors hover:text-orange-800"
                            title="View on Amazon"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                              />
                            </svg>
                            Amazon
                          </a>
                        )}
                        {item.product.ebayItemId && (
                          <a
                            href={`https://www.ebay.com.au/itm/${item.product.ebayItemId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 transition-colors hover:text-blue-800"
                            title="View on eBay"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                              />
                            </svg>
                            eBay
                          </a>
                        )}
                        {item.variant && (
                          <span className="text-xs text-gray-400">
                            Variant: {item.variant.title}
                          </span>
                        )}
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${sourceClasses}`}
                        >
                          {sourceLabel}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatMoney(item.previousPrice)} {"->"}{" "}
                      {formatMoney(item.newPrice)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatMoney(item.previousSellPrice)} {"->"}{" "}
                      {formatMoney(item.newSellPrice)}
                    </td>
                    <td
                      className={`px-4 py-3 text-sm font-medium ${
                        priceWentUp ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {priceWentUp ? "+" : ""}
                      {item.changePercent.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${historyStatus.classes}`}
                      >
                        {historyStatus.label}
                      </span>
                      {item.errorMessage && (
                        <div
                          className="mt-1 max-w-xs truncate text-xs text-red-600"
                          title={item.errorMessage}
                        >
                          {item.errorMessage}
                        </div>
                      )}
                      {isPendingReview && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleHistoryReview(item.id, "apply")}
                            disabled={reviewingHistoryId === item.id}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => handleHistoryReview(item.id, "dismiss")}
                            disabled={reviewingHistoryId === item.id}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
