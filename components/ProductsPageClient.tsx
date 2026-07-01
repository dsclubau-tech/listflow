"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ActionProgressBar from "@/components/ActionProgressBar";
import BulkEditModal from "@/components/BulkEditModal";
import DraftsTable from "@/components/DraftsTable";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { getSelectedPriceCheckSummary } from "@/lib/price-check-eligibility";
import {
  getProductAdvancedFilter,
  PRODUCT_ADVANCED_FILTERS,
  type ProductAdvancedFilterId,
} from "@/lib/product-filter-definitions";
import type { SerializedProductRow } from "@/types/product-row";

interface ProductsPageClientProps {
  products: SerializedProductRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  importedFilter: "today" | null;
  productFilter: ProductFilter;
  hasAdvancedFilters: boolean;
  supplierOptions: Array<{ id: string; name: string }>;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const PAGE_SIZE_STORAGE_KEY = "listflow.products.pageSize";
const PRICE_CHECK_JOB_STORAGE_KEY = "listflow.products.activePriceCheckJobId";

type PriceCheckJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";
type PriceCheckJobScope = "SELECTED" | "ALL";
type ProductFilter = "all" | "needs-changing-price" | "failed-on-hold";

const PRODUCT_FILTER_OPTIONS: Array<{ value: ProductFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs-changing-price", label: "Needs changing price" },
  { value: "failed-on-hold", label: "Failed / On hold" },
];
const RANGE_FILTER_IDS = new Set<ProductAdvancedFilterId>([
  "sellPrice",
  "buyPrice",
  "profit",
  "quantity",
  "fees",
]);
const STATIC_SELECT_OPTIONS: Partial<
  Record<ProductAdvancedFilterId, Array<{ value: string; label: string }>>
> = {
  inventoryStatus: [
    { value: "imported", label: "Imported" },
    { value: "on-hold", label: "On Hold" },
    { value: "check-failed", label: "Check failed" },
  ],
  stockMonitoring: [
    { value: "low-stock", label: "Low stock" },
    { value: "has-stock-data", label: "Has stock data" },
    { value: "no-stock-data", label: "No stock data" },
  ],
  priceMonitoring: [
    { value: "needs-changing-price", label: "Needs changing price" },
    { value: "check-failed", label: "Check failed" },
    { value: "not-checked", label: "Not checked" },
    { value: "checked", label: "Checked" },
    { value: "tracked", label: "Tracked" },
  ],
  autoOrder: [
    { value: "configured", label: "Configured" },
    { value: "not-configured", label: "Not configured" },
  ],
  veroViolation: [{ value: "potential", label: "Potential issue" }],
};

function getRangeParamKeys(filterId: ProductAdvancedFilterId) {
  return {
    min: `${filterId}Min`,
    max: `${filterId}Max`,
  };
}

interface PriceCheckJob {
  id: string;
  status: PriceCheckJobStatus;
  scope: PriceCheckJobScope;
  total: number;
  checked: number;
  changed: number;
  pendingReview: number;
  failed: number;
  skipped: number;
  remaining: number;
  canResume: boolean;
  reason: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
}

function isActivePriceCheckJob(job: PriceCheckJob | null) {
  return (
    job?.status === "QUEUED" ||
    job?.status === "RUNNING" ||
    job?.status === "CANCELLING"
  );
}

function isTerminalPriceCheckJob(job: PriceCheckJob | null) {
  return (
    job?.status === "COMPLETED" ||
    job?.status === "FAILED" ||
    job?.status === "CANCELLED"
  );
}

function isResumablePriceCheckJob(job: PriceCheckJob | null): job is PriceCheckJob {
  return job?.status === "CANCELLED" && job.canResume && job.remaining > 0;
}

function getPriceCheckJobSummary(job: PriceCheckJob) {
  if (job.status === "FAILED") {
    return job.errorMessage || "Price check failed.";
  }

  if (job.status === "CANCELLED") {
    return `Price check cancelled. Checked ${job.checked} product${job.checked === 1 ? "" : "s"}. ${job.pendingReview} pending review, ${job.failed} failed, ${job.skipped} unchanged.`;
  }

  if (job.reason) {
    return job.reason;
  }

  return `Checked ${job.checked} product${job.checked === 1 ? "" : "s"}. ${job.pendingReview} pending review, ${job.failed} failed, ${job.skipped} unchanged.`;
}

function getPriceCheckJobStatusText(job: PriceCheckJob) {
  if (job.status === "QUEUED") {
    return `Price check queued for ${job.total} product${job.total === 1 ? "" : "s"}.`;
  }

  if (job.status === "RUNNING") {
    return `Checking prices ${job.checked}/${job.total}...`;
  }

  if (job.status === "CANCELLING") {
    return "Stopping after current product...";
  }

  if (job.status === "COMPLETED") {
    return getPriceCheckJobSummary(job);
  }

  return getPriceCheckJobSummary(job);
}

export default function ProductsPageClient({
  products,
  totalCount,
  page,
  pageSize,
  importedFilter,
  productFilter,
  hasAdvancedFilters,
  supplierOptions,
}: ProductsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const focusedProductId = searchParams.get("productId");
  const [isExporting, setIsExporting] = useState(false);
  const [isStartingPriceCheckJob, setIsStartingPriceCheckJob] = useState(false);
  const [isCancellingPriceCheckJob, setIsCancellingPriceCheckJob] =
    useState(false);
  const [isResumingPriceCheckJob, setIsResumingPriceCheckJob] = useState(false);
  const [priceCheckJob, setPriceCheckJob] = useState<PriceCheckJob | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const notifiedTerminalJobIds = useRef<Set<string>>(new Set());
  const { toast, showToast, hideToast } = useToast();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const isPriceCheckJobActive = isActivePriceCheckJob(priceCheckJob);
  const selectedPriceCheckSummary = useMemo(
    () => getSelectedPriceCheckSummary(products, selectedProductIds),
    [products, selectedProductIds]
  );
  const selectedHasNoEligiblePriceChecks =
    selectedProductIds.length > 0 && selectedPriceCheckSummary.eligibleCount === 0;
  const listingCountLabel =
    hasAdvancedFilters
      ? "filtered listings"
      : productFilter === "needs-changing-price"
      ? "listings needing price changes"
      : productFilter === "failed-on-hold"
        ? "failed / on hold listings"
        : searchQuery
          ? "search results"
        : importedFilter === "today"
          ? "listings added today"
          : "listings";
  const firstVisibleProduct =
    totalCount === 0 ? 0 : Math.min(totalCount, (page - 1) * pageSize + 1);
  const lastVisibleProduct =
    totalCount === 0 ? 0 : Math.min(totalCount, page * pageSize);

  useEffect(() => {
    const savedPageSize = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const parsed = Number(savedPageSize);

    if (
      !PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number]) ||
      parsed === pageSize ||
      searchParams.get("pageSize")
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    params.set("pageSize", String(parsed));
    router.replace(`${pathname}?${params.toString()}`);
  }, [pageSize, pathname, router, searchParams]);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  const storePriceCheckJob = useCallback((job: PriceCheckJob | null) => {
    setPriceCheckJob(job);

    if (!job || (isTerminalPriceCheckJob(job) && !isResumablePriceCheckJob(job))) {
      window.localStorage.removeItem(PRICE_CHECK_JOB_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(PRICE_CHECK_JOB_STORAGE_KEY, job.id);
  }, []);

  const handleTerminalPriceCheckJob = useCallback(
    (job: PriceCheckJob, notify: boolean) => {
      if (!isResumablePriceCheckJob(job)) {
        window.localStorage.removeItem(PRICE_CHECK_JOB_STORAGE_KEY);
      }

      setIsCancellingPriceCheckJob(false);
      setIsResumingPriceCheckJob(false);

      if (!notify || notifiedTerminalJobIds.current.has(job.id)) {
        return;
      }

      router.refresh();
      notifiedTerminalJobIds.current.add(job.id);
      showToast(
        getPriceCheckJobSummary(job),
        job.status === "FAILED" || job.failed > 0 ? "error" : "success"
      );
    },
    [router, showToast]
  );

  const dismissPriceCheckJob = useCallback(async () => {
    const job = priceCheckJob;
    window.localStorage.removeItem(PRICE_CHECK_JOB_STORAGE_KEY);
    setPriceCheckJob(null);

    if (!job || !isTerminalPriceCheckJob(job)) {
      return;
    }

    try {
      const response = await fetch(`/api/price-check/jobs/${job.id}/dismiss`, {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Failed to dismiss job.");
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to dismiss job.",
        "error"
      );
    }
  }, [priceCheckJob, showToast]);

  const applyPriceCheckJob = useCallback(
    (job: PriceCheckJob | null, notifyTerminal = false) => {
      storePriceCheckJob(job);

      if (job && isTerminalPriceCheckJob(job)) {
        handleTerminalPriceCheckJob(job, notifyTerminal);
      }
    },
    [handleTerminalPriceCheckJob, storePriceCheckJob]
  );

  const fetchPriceCheckJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/price-check/jobs/${jobId}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      return null;
    }

    const data = (await response.json().catch(() => ({}))) as {
      job?: PriceCheckJob | null;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load price check job.");
    }

    return data.job ?? null;
  }, []);

  const fetchCurrentPriceCheckJob = useCallback(async () => {
    const response = await fetch("/api/price-check/jobs/current", {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      job?: PriceCheckJob | null;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load current price check job.");
    }

    return data.job ?? null;
  }, []);

  const cancelActivePriceCheckJob = useCallback(async () => {
    if (!priceCheckJob || !isActivePriceCheckJob(priceCheckJob)) {
      return;
    }

    setIsCancellingPriceCheckJob(true);

    try {
      const response = await fetch(
        `/api/price-check/jobs/${priceCheckJob.id}/cancel`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        job?: PriceCheckJob | null;
        error?: string;
      };

      if (!response.ok || !data.job) {
        throw new Error(data.error || "Failed to stop price check.");
      }

      applyPriceCheckJob(data.job, true);

      if (data.job.status === "CANCELLING") {
        showToast("Stopping after current product...", "success");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop price check.";
      showToast(message, "error");
      setIsCancellingPriceCheckJob(false);
    }
  }, [applyPriceCheckJob, priceCheckJob, showToast]);

  const resumeCancelledPriceCheckJob = useCallback(async () => {
    const jobToResume = priceCheckJob;

    if (!isResumablePriceCheckJob(jobToResume)) {
      showToast("No remaining products to resume.", "error");
      return;
    }

    setIsResumingPriceCheckJob(true);

    try {
      const response = await fetch(
        `/api/price-check/jobs/${jobToResume.id}/resume`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        job?: PriceCheckJob;
        reused?: boolean;
        resumed?: boolean;
        error?: string;
      };

      if (!response.ok || !data.job) {
        throw new Error(data.error || "Failed to resume price check.");
      }

      applyPriceCheckJob(data.job, true);

      if (data.reused) {
        showToast("A price check is already running.", "success");
      } else if (data.resumed && isActivePriceCheckJob(data.job)) {
        showToast(
          `Resumed price check for ${data.job.total} product${data.job.total === 1 ? "" : "s"}.`,
          "success"
        );
      } else {
        showToast("No remaining products to resume.", "success");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resume price check.";
      showToast(message, "error");
    } finally {
      setIsResumingPriceCheckJob(false);
    }
  }, [applyPriceCheckJob, priceCheckJob, showToast]);

  useEffect(() => {
    let cancelled = false;

    async function restorePriceCheckJob() {
      try {
        const savedJobId = window.localStorage.getItem(PRICE_CHECK_JOB_STORAGE_KEY);
        let restoredSavedJob = false;
        let job: PriceCheckJob | null = savedJobId
          ? await fetchPriceCheckJob(savedJobId)
          : null;

        restoredSavedJob = Boolean(job && savedJobId);

        if (!job) {
          job = await fetchCurrentPriceCheckJob();
        }

        if (!cancelled && job) {
          applyPriceCheckJob(
            job,
            !(restoredSavedJob && isTerminalPriceCheckJob(job))
          );
        }
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(PRICE_CHECK_JOB_STORAGE_KEY);
        }
      }
    }

    void restorePriceCheckJob();

    return () => {
      cancelled = true;
    };
  }, [applyPriceCheckJob, fetchCurrentPriceCheckJob, fetchPriceCheckJob]);

  useEffect(() => {
    if (!priceCheckJob || !isActivePriceCheckJob(priceCheckJob)) {
      return;
    }

    let cancelled = false;
    const jobId = priceCheckJob.id;

    async function pollPriceCheckJob() {
      try {
        const job = await fetchPriceCheckJob(jobId);

        if (!cancelled) {
          applyPriceCheckJob(job, true);
        }
      } catch {
        // Keep the current banner visible; the next poll may succeed.
      }
    }

    const interval = window.setInterval(() => {
      void pollPriceCheckJob();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyPriceCheckJob, fetchPriceCheckJob, priceCheckJob]);

  const applySearchQuery = useCallback(
    (value: string, mode: "push" | "replace" = "replace") => {
      const trimmed = value.trim();
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", "1");

      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }

      const queryString = params.toString();
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;

      if (mode === "push") {
        router.push(nextUrl);
      } else {
        router.replace(nextUrl);
      }
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (searchDraft === searchQuery) {
      return;
    }

    const timeout = window.setTimeout(() => {
      applySearchQuery(searchDraft);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [applySearchQuery, searchDraft, searchQuery]);

  function navigateProductsPage(nextPage: number, nextPageSize = pageSize) {
    const boundedPage = Math.min(
      Math.max(1, nextPage),
      Math.max(1, Math.ceil(totalCount / nextPageSize))
    );
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(boundedPage));
    params.set("pageSize", String(nextPageSize));
    router.push(`${pathname}?${params.toString()}`);
  }

  function handlePageSizeChange(value: string) {
    const parsed = Number(value);

    if (!PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return;
    }

    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(parsed));
    navigateProductsPage(1, parsed);
  }

  function handleProductFilterChange(nextFilter: ProductFilter) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");

    if (nextFilter === "all") {
      params.delete("filter");
    } else {
      params.set("filter", nextFilter);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  function getSelectOptions(filterId: ProductAdvancedFilterId) {
    if (filterId === "supplier") {
      return supplierOptions.map((store) => ({
        value: store.id,
        label: store.name,
      }));
    }

    return STATIC_SELECT_OPTIONS[filterId] ?? [];
  }

  function isAdvancedFilterActive(filterId: ProductAdvancedFilterId) {
    if (RANGE_FILTER_IDS.has(filterId)) {
      const keys = getRangeParamKeys(filterId);
      return searchParams.has(keys.min) || searchParams.has(keys.max);
    }

    return searchParams.has(filterId);
  }

  function updateFilterParams(
    update: (params: URLSearchParams) => void,
    mode: "push" | "replace" = "replace"
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    update(params);
    const nextUrl = `${pathname}?${params.toString()}`;

    if (mode === "push") {
      router.push(nextUrl);
    } else {
      router.replace(nextUrl);
    }
  }

  function handleAddAdvancedFilter(filterId: ProductAdvancedFilterId) {
    const filter = getProductAdvancedFilter(filterId);

    if (!filter?.enabled) {
      return;
    }

    updateFilterParams((params) => {
      if (RANGE_FILTER_IDS.has(filterId)) {
        const keys = getRangeParamKeys(filterId);
        params.set(keys.min, "");
        params.set(keys.max, "");
        return;
      }

      if (filter.control === "select") {
        const firstOption = getSelectOptions(filterId)[0]?.value ?? "";
        params.set(filterId, firstOption);
        return;
      }

      params.set(filterId, "");
    }, "push");
    setIsFilterMenuOpen(false);
  }

  function handleRemoveAdvancedFilter(filterId: ProductAdvancedFilterId) {
    updateFilterParams((params) => {
      if (RANGE_FILTER_IDS.has(filterId)) {
        const keys = getRangeParamKeys(filterId);
        params.delete(keys.min);
        params.delete(keys.max);
        return;
      }

      params.delete(filterId);
    }, "push");
  }

  function handleClearFilters() {
    updateFilterParams((params) => {
      params.delete("filter");
      PRODUCT_ADVANCED_FILTERS.forEach((filter) => {
        if (RANGE_FILTER_IDS.has(filter.id)) {
          const keys = getRangeParamKeys(filter.id);
          params.delete(keys.min);
          params.delete(keys.max);
          return;
        }

        params.delete(filter.id);
      });
    }, "push");
  }

  function renderAdvancedFilterControl(filterId: ProductAdvancedFilterId) {
    const filter = getProductAdvancedFilter(filterId);

    if (!filter) {
      return null;
    }

    if (RANGE_FILTER_IDS.has(filterId)) {
      const keys = getRangeParamKeys(filterId);

      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={searchParams.get(keys.min) ?? ""}
            onChange={(event) =>
              updateFilterParams((params) => {
                params.set(keys.min, event.target.value);
              })
            }
            placeholder="Min"
            className="h-8 w-20 rounded border border-gray-300 px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          />
          <input
            type="number"
            inputMode="decimal"
            value={searchParams.get(keys.max) ?? ""}
            onChange={(event) =>
              updateFilterParams((params) => {
                params.set(keys.max, event.target.value);
              })
            }
            placeholder="Max"
            className="h-8 w-20 rounded border border-gray-300 px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
      );
    }

    if (filter.control === "select") {
      const options = getSelectOptions(filterId);

      return (
        <select
          value={searchParams.get(filterId) ?? ""}
          onChange={(event) =>
            updateFilterParams((params) => {
              params.set(filterId, event.target.value);
            })
          }
          className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
        >
          {options.length === 0 && <option value="">None</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="text"
        value={searchParams.get(filterId) ?? ""}
        onChange={(event) =>
          updateFilterParams((params) => {
            params.set(filterId, event.target.value);
          })
        }
        placeholder={filter.label}
        className="h-8 w-44 rounded border border-gray-300 px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
      />
    );
  }

  const activeAdvancedFilters = PRODUCT_ADVANCED_FILTERS.filter((filter) =>
    isAdvancedFilterActive(filter.id)
  );
  const canClearFilters =
    productFilter !== "all" || activeAdvancedFilters.length > 0;

  const handleExportCsv = async () => {
    setIsExporting(true);

    try {
      const response = await fetch("/api/products/export-csv", {
        method: "GET",
      });

      if (!response.ok) {
        let errorMessage = "Failed to export CSV";

        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) {
            errorMessage = data.error;
          }
        } catch {
          // Ignore invalid JSON and fall back to the generic error.
        }

        throw new Error(errorMessage);
      }

      const exportedCount = Number.parseInt(
        response.headers.get("X-Exported-Products") ?? "0",
        10
      );
      const skippedCount = Number.parseInt(
        response.headers.get("X-Skipped-Products") ?? "0",
        10
      );

      if (exportedCount === 0) {
        showToast(
          skippedCount > 0
            ? `No products were exported. Skipped ${skippedCount} without eBay ID or ASIN.`
            : "No eligible products were found to export.",
          "error"
        );
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition = response.headers.get("Content-Disposition");
      const matchedFilename = contentDisposition?.match(/filename="?([^"]+)"?/i);

      link.href = url;
      link.download = matchedFilename?.[1] ?? "listflow_products_export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showToast(
        skippedCount > 0
          ? `Exported ${exportedCount} products to CSV. Skipped ${skippedCount} without eBay ID or ASIN.`
          : `Exported ${exportedCount} products to CSV.`,
        "success"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export CSV";
      showToast(message, "error");
    } finally {
      setIsExporting(false);
    }
  };

  const startPriceCheckJob = useCallback(
    async (productIds?: string[]) => {
      if (isPriceCheckJobActive) {
        showToast("A price check is already running.", "error");
        return;
      }

      setIsStartingPriceCheckJob(true);

      try {
        let selectedIds = productIds?.filter(Boolean) ?? [];
        let skippedSelectedMessage: string | null = null;

        if (selectedIds.length > 0) {
          const selection = getSelectedPriceCheckSummary(products, selectedIds);

          if (selection.eligibleCount === 0) {
            showToast(selection.message, "error");
            return;
          }

          selectedIds = selection.eligibleIds;

          if (selection.ineligibleCount > 0) {
            skippedSelectedMessage = selection.message;
          }
        }

        const response = await fetch("/api/price-check/jobs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            selectedIds.length > 0 ? { productIds: selectedIds } : { all: true }
          ),
        });
        const data = (await response.json().catch(() => ({}))) as {
          job?: PriceCheckJob;
          reused?: boolean;
          error?: string;
        };

        if (!response.ok || !data.job) {
          throw new Error(data.error || "Failed to start price check job.");
        }

        applyPriceCheckJob(data.job, true);

        if (isActivePriceCheckJob(data.job)) {
          showToast(
            data.reused
              ? "A price check is already running."
              : skippedSelectedMessage
                ? `Price check started for ${data.job.total} product${
                    data.job.total === 1 ? "" : "s"
                  }. ${skippedSelectedMessage}`
                : `Price check started for ${data.job.total} product${data.job.total === 1 ? "" : "s"}.`,
            "success"
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start price check job";
        showToast(message, "error");
      } finally {
        setIsStartingPriceCheckJob(false);
      }
    },
    [applyPriceCheckJob, isPriceCheckJobActive, products, showToast]
  );

  const handleCheckPrices = () => {
    void startPriceCheckJob(
      selectedHasNoEligiblePriceChecks ? undefined : selectedProductIds
    );
  };
  const isPriceCheckJobStopping =
    isCancellingPriceCheckJob || priceCheckJob?.status === "CANCELLING";
  const isPriceCheckJobResumable = isResumablePriceCheckJob(priceCheckJob);
  const priceCheckProgressPercent = priceCheckJob?.total
    ? Math.min(100, Math.round((priceCheckJob.checked / priceCheckJob.total) * 100))
    : 0;

  return (
    <>
      {priceCheckJob && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
            priceCheckJob.status === "FAILED" || priceCheckJob.failed > 0
              ? "border-red-200 bg-red-50 text-red-800"
              : priceCheckJob.status === "CANCELLED"
                ? "border-amber-200 bg-amber-50 text-amber-800"
              : isActivePriceCheckJob(priceCheckJob)
                ? "border-blue-200 bg-blue-50 text-blue-800"
                : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <div className="min-w-[260px] flex-1">
            {isActivePriceCheckJob(priceCheckJob) ? (
              <ActionProgressBar
                label={getPriceCheckJobStatusText(priceCheckJob)}
                percent={priceCheckProgressPercent}
                detail={`${priceCheckJob.pendingReview} pending review, ${priceCheckJob.failed} failed, ${priceCheckJob.skipped} unchanged`}
                tone={priceCheckJob.status === "CANCELLING" ? "amber" : "blue"}
              />
            ) : (
              <span className="font-medium">{getPriceCheckJobStatusText(priceCheckJob)}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isActivePriceCheckJob(priceCheckJob) && (
              <button
                type="button"
                onClick={cancelActivePriceCheckJob}
                disabled={isPriceCheckJobStopping}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPriceCheckJobStopping ? "Stopping..." : "Stop"}
              </button>
            )}
            {isPriceCheckJobResumable && (
              <button
                type="button"
                onClick={resumeCancelledPriceCheckJob}
                disabled={isResumingPriceCheckJob}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResumingPriceCheckJob ? "Resuming..." : "Resume"}
              </button>
            )}
            {isTerminalPriceCheckJob(priceCheckJob) && (
              <button
                type="button"
                onClick={() => void dismissPriceCheckJob()}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <span className="text-sm text-gray-500">
            ({totalCount} {listingCountLabel})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              applySearchQuery(searchDraft, "push");
            }}
            className="relative w-full sm:w-72 lg:w-80"
          >
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
              />
            </svg>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search products, IDs, ASIN..."
              aria-label="Search products"
              className="h-10 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  applySearchQuery("", "push");
                }}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Clear product search"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </form>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsFilterMenuOpen((open) => !open)}
              className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-amber-50"
            >
              <svg
                className="h-4 w-4 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M7 12h10M10 18h4"
                />
              </svg>
              Add Filter
            </button>
            {isFilterMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-md border border-gray-200 bg-white py-2 shadow-lg">
                {PRODUCT_ADVANCED_FILTERS.map((filter) => {
                  const active = isAdvancedFilterActive(filter.id);
                  const disabled = !filter.enabled || active;

                  return (
                    <button
                      key={filter.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleAddAdvancedFilter(filter.id)}
                      title={!filter.enabled ? "No matching product field yet" : undefined}
                      className={`block w-full px-4 py-2 text-left text-sm font-medium transition-colors ${
                        active
                          ? "bg-gray-50 text-gray-400"
                          : filter.enabled
                            ? "text-gray-700 hover:bg-amber-50"
                            : "cursor-not-allowed text-gray-300"
                      }`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white shadow-sm">
            {PRODUCT_FILTER_OPTIONS.map((option) => {
              const selected = option.value === productFilter;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleProductFilterChange(option.value)}
                  aria-pressed={selected}
                  className={`border-r border-gray-300 px-3 py-2 text-sm font-medium transition-colors last:border-r-0 ${
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
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Rows
            <select
              value={pageSize}
              onChange={(event) => handlePageSizeChange(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleCheckPrices}
            disabled={isStartingPriceCheckJob || isPriceCheckJobActive}
            title={
              selectedHasNoEligiblePriceChecks
                ? `${selectedPriceCheckSummary.message} This button will check all other trackable products.`
                : selectedProductIds.length > 0
                ? selectedPriceCheckSummary.message
                : "Check prices for all tracked products"
            }
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            {isStartingPriceCheckJob
              ? "Starting..."
              : isPriceCheckJobStopping
                ? "Stopping..."
              : isPriceCheckJobActive
                ? `Checking ${priceCheckJob?.checked ?? 0}/${priceCheckJob?.total ?? 0}`
              : selectedHasNoEligiblePriceChecks
                ? "Check All Trackable"
              : selectedProductIds.length > 0
                ? selectedPriceCheckSummary.eligibleCount > 0
                  ? `Check ${selectedPriceCheckSummary.eligibleCount} Selected`
                  : "Check Selected"
                : "Check Prices Now"}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="inline-flex items-center gap-2 rounded-md border border-orange-500 px-3 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                d="M12 3v12m0 0 4-4m-4 4-4-4m-3 8h14"
              />
            </svg>
            {isExporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      {canClearFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeAdvancedFilters.map((filter) => (
            <div
              key={filter.id}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-sm"
            >
              <span className="px-1 text-xs font-semibold text-gray-700">
                {filter.label}
              </span>
              {renderAdvancedFilterControl(filter.id)}
              <button
                type="button"
                onClick={() => handleRemoveAdvancedFilter(filter.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label={`Remove ${filter.label} filter`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleClearFilters}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          >
            Clear filters
          </button>
        </div>
      )}

      <DraftsTable
        products={products}
        onToast={showToast}
        view="products"
        autoExpandProductId={focusedProductId}
        onSelectionChange={setSelectedProductIds}
        onPriceCheckSelected={startPriceCheckJob}
        isPriceCheckJobActive={isStartingPriceCheckJob || isPriceCheckJobActive}
        onBulkEditSelected={(ids) => {
          setSelectedProductIds(ids);
          setIsBulkEditOpen(true);
        }}
      />

      <BulkEditModal
        open={isBulkEditOpen}
        products={products}
        selectedProductIds={selectedProductIds}
        onClose={() => setIsBulkEditOpen(false)}
        onToast={showToast}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
        <span>
          {firstVisibleProduct}-{lastVisibleProduct} of {totalCount}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateProductsPage(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-2 text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => navigateProductsPage(page + 1)}
            disabled={page >= totalPages}
            className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
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
