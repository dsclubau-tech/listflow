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

interface PriceTrackerClientProps {
  initialSummary: PriceTrackerSummary;
  initialHistory: PriceTrackerHistoryItem[];
}

type DirectionFilter = "all" | "up" | "down";
type SortValue = "newest" | "largest" | "smallest";

function formatMoney(value: string) {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  return `A$${amount.toFixed(2)}`;
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

export default function PriceTrackerClient({
  initialSummary,
  initialHistory,
}: PriceTrackerClientProps) {
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const [isChecking, setIsChecking] = useState(false);
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilter>("all");
  const [sortBy, setSortBy] = useState<SortValue>("newest");

  useEffect(() => {
    if (!isChecking) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [isChecking, router]);

  const filteredHistory = useMemo(() => {
    const directionFiltered = initialHistory.filter((item) => {
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
  }, [directionFilter, initialHistory, sortBy]);

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

      const data = (await response.json()) as {
        checked?: number;
        changed?: number;
        failed?: number;
        skipped?: number;
        reason?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to check prices");
      }

      showToast(
        data.reason
          ? data.reason
          : `Checked ${data.checked ?? 0} products. ${data.changed ?? 0} changed, ${data.failed ?? 0} failed, ${data.skipped ?? 0} unchanged.`,
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

  return (
    <>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Price Tracker</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor Amazon buy-price changes and the resulting eBay listing
            revisions.
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
                      {item.variant && (
                        <div className="mt-1 text-xs text-gray-500">
                          Variant: {item.variant.title}
                        </div>
                      )}
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
                        priceWentUp ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {priceWentUp ? "+" : ""}
                      {item.changePercent.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          item.ebayRevised
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {item.ebayRevised ? "Revised" : "Failed"}
                      </span>
                      {item.errorMessage && (
                        <div
                          className="mt-1 max-w-xs truncate text-xs text-red-600"
                          title={item.errorMessage}
                        >
                          {item.errorMessage}
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
