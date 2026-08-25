"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import ActionProgressBar from "@/components/ActionProgressBar";
import BulkEditModal from "@/components/BulkEditModal";
import DraftsTable from "@/components/DraftsTable";
import PromotedListingsModal, {
  type PromotedListingsJob,
} from "@/components/PromotedListingsModal";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { getSelectedPriceCheckSummary } from "@/lib/price-check-eligibility";
import {
  getProductAdvancedFilter,
  PRODUCT_ADVANCED_FILTERS,
  type ProductAdvancedFilterId,
} from "@/lib/product-filter-definitions";
import {
  buildProductFilterUrl,
  buildProductSortUrl,
  type ProductQuickFilter,
} from "@/lib/product-filter-navigation";
import { getProductSelectionScopeKey } from "@/lib/product-selection";
import type { ProductSortField, ProductSortOrder } from "@/lib/product-sort";
import type { ProductSelectionSummary } from "@/types/product-selection";
import type { SerializedProductRow } from "@/types/product-row";

interface ProductsPageClientProps {
  products: SerializedProductRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  sortBy: ProductSortField | null;
  sortOrder: ProductSortOrder;
  importedFilter: "today" | null;
  productFilter: ProductQuickFilter;
  hasAdvancedFilters: boolean;
  supplierOptions: Array<{ id: string; name: string }>;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const PAGE_SIZE_STORAGE_KEY = "listflow.products.pageSize";
const PRICE_CHECK_JOB_STORAGE_KEY = "listflow.products.activePriceCheckJobId";
const PROMOTED_LISTINGS_JOB_STORAGE_KEY =
  "listflow.products.activePromotedListingsJobId";

type PriceCheckJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";
type PriceCheckJobScope = "SELECTED" | "ALL";
type EbayAdsSyncProgress = {
  type?: "progress" | "done" | "error";
  phase: string;
  total: number;
  processed: number;
  promoted: number;
  notPromoted: number;
  fixedRate: number;
  dynamic: number;
  percent: number;
  syncedAt?: string;
  error?: string;
};
type ProductSearchSuggestion = {
  id: string;
  title: string;
  asin: string | null;
  ebayItemId: string | null;
  image: string | null;
};

function isActivePromotedListingsJob(job: PromotedListingsJob | null) {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

function getPromotedListingsJobSummary(job: PromotedListingsJob) {
  return `${job.succeeded} listing${job.succeeded === 1 ? "" : "s"} updated, ${job.failed} failed.`;
}

const PRODUCT_FILTER_OPTIONS: Array<{
  value: ProductQuickFilter;
  label: string;
}> = [
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
  "promotedAdPercent",
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
  adFeeStatus: [
    { value: "promoted", label: "Promoted" },
    { value: "not-promoted", label: "Not promoted" },
    { value: "not-synced", label: "Not synced" },
  ],
};

const INITIAL_EBAY_ADS_SYNC_PROGRESS: EbayAdsSyncProgress = {
  type: "progress",
  phase: "Starting eBay ad sync",
  total: 0,
  processed: 0,
  promoted: 0,
  notPromoted: 0,
  fixedRate: 0,
  dynamic: 0,
  percent: 0,
};

function getEbayAdsSyncDetail(progress: EbayAdsSyncProgress) {
  if (progress.error) {
    return progress.error;
  }

  if (progress.total <= 0) {
    return progress.phase;
  }

  return [
    `${progress.processed}/${progress.total} listings viewed`,
    `${progress.promoted} promoted on eBay`,
    `${progress.notPromoted} not promoted`,
    `${progress.fixedRate} fixed-rate`,
    `${progress.dynamic} dynamic`,
  ].join(", ");
}

function getRangeParamKeys(filterId: ProductAdvancedFilterId) {
  return {
    min: `${filterId}Min`,
    max: `${filterId}Max`,
  };
}

type AdvancedFilterDraft = Partial<Record<string, string>>;

function hasDraftKey(draft: AdvancedFilterDraft, key: string) {
  return Object.prototype.hasOwnProperty.call(draft, key);
}

function getAdvancedFilterDraftFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  const draft: AdvancedFilterDraft = {};

  PRODUCT_ADVANCED_FILTERS.forEach((filter) => {
    if (RANGE_FILTER_IDS.has(filter.id)) {
      const keys = getRangeParamKeys(filter.id);

      if (params.has(keys.min)) {
        draft[keys.min] = params.get(keys.min) ?? "";
      }

      if (params.has(keys.max)) {
        draft[keys.max] = params.get(keys.max) ?? "";
      }

      return;
    }

    if (params.has(filter.id)) {
      draft[filter.id] = params.get(filter.id) ?? "";
    }
  });

  return draft;
}

function isAdvancedFilterInDraft(
  draft: AdvancedFilterDraft,
  filterId: ProductAdvancedFilterId
) {
  if (RANGE_FILTER_IDS.has(filterId)) {
    const keys = getRangeParamKeys(filterId);
    return hasDraftKey(draft, keys.min) || hasDraftKey(draft, keys.max);
  }

  return hasDraftKey(draft, filterId);
}

function getAdvancedFilterDraftSignature(draft: AdvancedFilterDraft) {
  return PRODUCT_ADVANCED_FILTERS.flatMap((filter) => {
    if (RANGE_FILTER_IDS.has(filter.id)) {
      const keys = getRangeParamKeys(filter.id);
      return [keys.min, keys.max]
        .filter((key) => hasDraftKey(draft, key))
        .map((key) => `${key}=${draft[key] ?? ""}`);
    }

    return hasDraftKey(draft, filter.id)
      ? [`${filter.id}=${draft[filter.id] ?? ""}`]
      : [];
  }).join("&");
}

function removeAdvancedFilterFromDraft(
  draft: AdvancedFilterDraft,
  filterId: ProductAdvancedFilterId
) {
  const next = { ...draft };

  if (RANGE_FILTER_IDS.has(filterId)) {
    const keys = getRangeParamKeys(filterId);
    delete next[keys.min];
    delete next[keys.max];
    return next;
  }

  delete next[filterId];
  return next;
}

function applyAdvancedFilterDraftToParams(
  params: URLSearchParams,
  draft: AdvancedFilterDraft
) {
  PRODUCT_ADVANCED_FILTERS.forEach((filter) => {
    if (RANGE_FILTER_IDS.has(filter.id)) {
      const keys = getRangeParamKeys(filter.id);
      const minValue = draft[keys.min]?.trim() ?? "";
      const maxValue = draft[keys.max]?.trim() ?? "";

      params.delete(keys.min);
      params.delete(keys.max);

      if (minValue) {
        params.set(keys.min, minValue);
      }

      if (maxValue) {
        params.set(keys.max, maxValue);
      }

      return;
    }

    const value = draft[filter.id]?.trim() ?? "";
    params.delete(filter.id);

    if (value) {
      params.set(filter.id, value);
    }
  });
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
  sortBy,
  sortOrder,
  importedFilter,
  productFilter,
  hasAdvancedFilters,
  supplierOptions,
}: ProductsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const searchQuery = searchParams.get("q") ?? "";
  const focusedProductId = searchParams.get("productId");
  const appliedAdvancedFilterDraft = useMemo(
    () => getAdvancedFilterDraftFromQueryString(searchParamsString),
    [searchParamsString]
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncingEbayAds, setIsSyncingEbayAds] = useState(false);
  const [ebayAdsSyncProgress, setEbayAdsSyncProgress] =
    useState<EbayAdsSyncProgress | null>(null);
  const [isStartingPriceCheckJob, setIsStartingPriceCheckJob] = useState(false);
  const [isCancellingPriceCheckJob, setIsCancellingPriceCheckJob] =
    useState(false);
  const [isResumingPriceCheckJob, setIsResumingPriceCheckJob] = useState(false);
  const [priceCheckJob, setPriceCheckJob] = useState<PriceCheckJob | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [allSelectionProducts, setAllSelectionProducts] = useState<
    ProductSelectionSummary[] | null
  >(null);
  const [isLoadingAllSelection, setIsLoadingAllSelection] = useState(false);
  const [isCopyingTitles, setIsCopyingTitles] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isPromotedListingsOpen, setIsPromotedListingsOpen] = useState(false);
  const [promotedListingsJob, setPromotedListingsJob] =
    useState<PromotedListingsJob | null>(null);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [pendingProductFilter, setPendingProductFilter] =
    useState<ProductQuickFilter | null>(null);
  const [isProductFilterPending, startProductFilterTransition] = useTransition();
  const [isProductSortPending, startProductSortTransition] = useTransition();
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [searchSuggestions, setSearchSuggestions] = useState<
    ProductSearchSuggestion[]
  >([]);
  const [isSearchSuggestionsOpen, setIsSearchSuggestionsOpen] = useState(false);
  const [isLoadingSearchSuggestions, setIsLoadingSearchSuggestions] =
    useState(false);
  const [activeSearchSuggestionIndex, setActiveSearchSuggestionIndex] =
    useState(-1);
  const [advancedFilterDraft, setAdvancedFilterDraft] = useState<AdvancedFilterDraft>(
    appliedAdvancedFilterDraft
  );
  const [pageJumpDraft, setPageJumpDraft] = useState(String(page));
  const notifiedTerminalJobIds = useRef<Set<string>>(new Set());
  const notifiedPromotionJobIds = useRef<Set<string>>(new Set());
  const failedSelectionScopeRef = useRef<string | null>(null);
  const selectionLoadRequestIdRef = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const { toast, showToast, hideToast } = useToast();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const isPromotionJobActive = isActivePromotedListingsJob(promotedListingsJob);
  const displayedProductFilter = pendingProductFilter ?? productFilter;
  const selectionScopeKey = useMemo(
    () => getProductSelectionScopeKey(searchParamsString),
    [searchParamsString],
  );
  const selectionProducts = useMemo<
    Array<SerializedProductRow | ProductSelectionSummary>
  >(
    () => allSelectionProducts ?? products,
    [allSelectionProducts, products],
  );
  const selectedPriceCheckSummary = useMemo(
    () => getSelectedPriceCheckSummary(selectionProducts, selectedProductIds),
    [selectionProducts, selectedProductIds]
  );
  const selectedProducts = useMemo(() => {
    const selectedIds = new Set(selectedProductIds);
    return selectionProducts.filter((product) => selectedIds.has(product.id));
  }, [selectionProducts, selectedProductIds]);
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

  const loadAllSelectionProducts = useCallback(async () => {
    const requestId = selectionLoadRequestIdRef.current + 1;
    selectionLoadRequestIdRef.current = requestId;
    setIsLoadingAllSelection(true);

    try {
      const query = selectionScopeKey ? `?${selectionScopeKey}` : "";
      const response = await fetch(`/api/products/selection${query}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        products?: ProductSelectionSummary[];
        totalCount?: number;
        error?: string;
      };

      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || "Unable to select all listings.");
      }

      if (selectionLoadRequestIdRef.current !== requestId) {
        return [];
      }

      failedSelectionScopeRef.current = null;
      setAllSelectionProducts(data.products);
      return data.products;
    } finally {
      if (selectionLoadRequestIdRef.current === requestId) {
        setIsLoadingAllSelection(false);
      }
    }
  }, [selectionScopeKey]);

  useEffect(() => {
    selectionLoadRequestIdRef.current += 1;
    setIsLoadingAllSelection(false);
    setSelectedProductIds([]);
    setAllSelectionProducts(null);
    failedSelectionScopeRef.current = null;
  }, [selectionScopeKey]);

  useEffect(() => {
    if (
      selectedProductIds.length === 0 ||
      allSelectionProducts ||
      isLoadingAllSelection ||
      failedSelectionScopeRef.current === selectionScopeKey
    ) {
      return;
    }

    void loadAllSelectionProducts().catch((error) => {
      failedSelectionScopeRef.current = selectionScopeKey;
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to load the complete selection.",
        "error",
      );
    });
  }, [
    allSelectionProducts,
    isLoadingAllSelection,
    loadAllSelectionProducts,
    selectionScopeKey,
    selectedProductIds.length,
    showToast,
  ]);

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

  useEffect(() => {
    const query = searchDraft.trim();

    if (query.length < 2) {
      setSearchSuggestions([]);
      setIsSearchSuggestionsOpen(false);
      setIsLoadingSearchSuggestions(false);
      setActiveSearchSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingSearchSuggestions(true);

      try {
        const response = await fetch(
          `/api/products/search-suggestions?q=${encodeURIComponent(query)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const data = (await response.json().catch(() => ({}))) as {
          suggestions?: ProductSearchSuggestion[];
        };

        if (!response.ok) {
          throw new Error("Failed to load product suggestions.");
        }

        const suggestions = data.suggestions ?? [];
        setSearchSuggestions(suggestions);
        setActiveSearchSuggestionIndex(-1);
        setIsSearchSuggestionsOpen(
          document.activeElement === searchInputRef.current
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSearchSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingSearchSuggestions(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [searchDraft]);

  useEffect(() => {
    function closeSearchSuggestions(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchSuggestionsOpen(false);
        setActiveSearchSuggestionIndex(-1);
      }
    }

    document.addEventListener("mousedown", closeSearchSuggestions);
    return () => document.removeEventListener("mousedown", closeSearchSuggestions);
  }, []);

  useEffect(() => {
    if (!isFilterMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        filterMenuRef.current &&
        !filterMenuRef.current.contains(event.target as Node)
      ) {
        setIsFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFilterMenuOpen(false);
        filterMenuButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterMenuOpen]);

  useEffect(() => {
    for (const option of PRODUCT_FILTER_OPTIONS) {
      router.prefetch(
        buildProductFilterUrl(pathname, searchParamsString, option.value)
      );
    }
  }, [pathname, router, searchParamsString]);

  useEffect(() => {
    setPendingProductFilter(null);
  }, [productFilter, searchParamsString]);

  useEffect(() => {
    setAdvancedFilterDraft(appliedAdvancedFilterDraft);
  }, [appliedAdvancedFilterDraft]);

  useEffect(() => {
    setPageJumpDraft(String(page));
  }, [page]);

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

  const cancelActivePriceCheckJob = useCallback(
    async (force = false) => {
      if (!priceCheckJob || !isActivePriceCheckJob(priceCheckJob)) {
        return;
      }

      const isForce = force || priceCheckJob.status === "CANCELLING";
      setIsCancellingPriceCheckJob(true);

      try {
        const response = await fetch(
          `/api/price-check/jobs/${priceCheckJob.id}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: isForce }),
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
        } else if (data.job.status === "CANCELLED") {
          showToast("Price check force-cancelled.", "success");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to stop price check.";
        showToast(message, "error");
      } finally {
        setIsCancellingPriceCheckJob(false);
      }
    },
    [applyPriceCheckJob, priceCheckJob, showToast]
  );

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
        showToast("Price check is queued.", "success");
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

  const applyPromotedListingsJob = useCallback(
    (job: PromotedListingsJob | null, notifyTerminal = false) => {
      setPromotedListingsJob(job);

      if (!job) {
        window.localStorage.removeItem(PROMOTED_LISTINGS_JOB_STORAGE_KEY);
        return;
      }

      if (isActivePromotedListingsJob(job)) {
        window.localStorage.setItem(PROMOTED_LISTINGS_JOB_STORAGE_KEY, job.id);
        return;
      }

      window.localStorage.removeItem(PROMOTED_LISTINGS_JOB_STORAGE_KEY);
      if (!notifyTerminal || notifiedPromotionJobIds.current.has(job.id)) {
        return;
      }

      notifiedPromotionJobIds.current.add(job.id);
      router.refresh();
      showToast(
        getPromotedListingsJobSummary(job),
        job.status === "FAILED" || job.failed > 0 ? "error" : "success",
      );
    },
    [router, showToast],
  );

  const fetchPromotedListingsJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/ebay/promoted-listings/jobs/${jobId}`, {
      cache: "no-store",
    });
    if (response.status === 404) return null;

    const data = (await response.json().catch(() => ({}))) as {
      job?: PromotedListingsJob;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Failed to load promotion job.");
    }
    return data.job ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restorePromotedListingsJob() {
      const jobId = window.localStorage.getItem(
        PROMOTED_LISTINGS_JOB_STORAGE_KEY,
      );
      if (!jobId) return;

      try {
        const job = await fetchPromotedListingsJob(jobId);
        if (!cancelled) applyPromotedListingsJob(job, true);
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(PROMOTED_LISTINGS_JOB_STORAGE_KEY);
        }
      }
    }

    void restorePromotedListingsJob();
    return () => {
      cancelled = true;
    };
  }, [applyPromotedListingsJob, fetchPromotedListingsJob]);

  useEffect(() => {
    const activeJob = promotedListingsJob;
    if (!activeJob || !isActivePromotedListingsJob(activeJob)) return;

    let cancelled = false;
    const jobId = activeJob.id;

    async function pollPromotedListingsJob() {
      try {
        const job = await fetchPromotedListingsJob(jobId);
        if (!cancelled) applyPromotedListingsJob(job, true);
      } catch {
        // Keep the current state visible; a later poll can recover.
      }
    }

    const interval = window.setInterval(() => {
      void pollPromotedListingsJob();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyPromotedListingsJob, fetchPromotedListingsJob, promotedListingsJob]);

  const applyProductSearchAndFilters = useCallback(
    (
      mode: "push" | "replace" = "push",
      options?: {
        search?: string;
        advancedDraft?: AdvancedFilterDraft;
        productFilterOverride?: ProductQuickFilter;
        productId?: string | null;
      }
    ) => {
      const trimmed = (options?.search ?? searchDraft).trim();
      const filtersToApply = options?.advancedDraft ?? advancedFilterDraft;
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", "1");

      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }

      if (options?.productId) {
        params.set("productId", options.productId);
      } else {
        params.delete("productId");
      }

      applyAdvancedFilterDraftToParams(params, filtersToApply);

      if (options?.productFilterOverride) {
        if (options.productFilterOverride === "all") {
          params.delete("filter");
        } else {
          params.set("filter", options.productFilterOverride);
        }
      }

      const queryString = params.toString();
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;

      if (mode === "push") {
        router.push(nextUrl);
      } else {
        router.replace(nextUrl);
      }
    },
    [advancedFilterDraft, pathname, router, searchDraft, searchParams]
  );

  const selectSearchSuggestion = useCallback(
    (suggestion: ProductSearchSuggestion) => {
      setSearchDraft(suggestion.title);
      setSearchSuggestions([]);
      setIsSearchSuggestionsOpen(false);
      setActiveSearchSuggestionIndex(-1);
      applyProductSearchAndFilters("push", {
        search: suggestion.title,
        productId: suggestion.id,
      });
    },
    [applyProductSearchAndFilters]
  );

  function handleSearchInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isSearchSuggestionsOpen || searchSuggestions.length === 0) {
      if (event.key === "Escape") {
        setIsSearchSuggestionsOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchSuggestionIndex((current) =>
        current >= searchSuggestions.length - 1 ? 0 : current + 1
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchSuggestionIndex((current) =>
        current <= 0 ? searchSuggestions.length - 1 : current - 1
      );
    } else if (event.key === "Enter" && activeSearchSuggestionIndex >= 0) {
      event.preventDefault();
      selectSearchSuggestion(searchSuggestions[activeSearchSuggestionIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsSearchSuggestionsOpen(false);
      setActiveSearchSuggestionIndex(-1);
    }
  }

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

  function handleProductSortChange(nextSortBy: ProductSortField) {
    startProductSortTransition(() => {
      router.push(buildProductSortUrl(pathname, searchParamsString, nextSortBy));
    });
  }

  function handlePageJumpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPage = Number.parseInt(pageJumpDraft, 10);

    if (!Number.isFinite(nextPage)) {
      setPageJumpDraft(String(page));
      return;
    }

    navigateProductsPage(nextPage);
  }

  function handleProductFilterChange(nextFilter: ProductQuickFilter) {
    if (nextFilter === productFilter || isProductFilterPending) {
      return;
    }

    setPendingProductFilter(nextFilter);
    setIsFilterMenuOpen(false);
    startProductFilterTransition(() => {
      router.push(
        buildProductFilterUrl(pathname, searchParamsString, nextFilter)
      );
    });
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
    return isAdvancedFilterInDraft(advancedFilterDraft, filterId);
  }

  function handleAddAdvancedFilter(filterId: ProductAdvancedFilterId) {
    const filter = getProductAdvancedFilter(filterId);

    if (!filter?.enabled) {
      return;
    }

    setAdvancedFilterDraft((current) => {
      if (isAdvancedFilterInDraft(current, filterId)) {
        return current;
      }

      const next = { ...current };

      if (RANGE_FILTER_IDS.has(filterId)) {
        const keys = getRangeParamKeys(filterId);
        next[keys.min] = "";
        next[keys.max] = "";
        return next;
      }

      if (filter.control === "select") {
        const firstOption = getSelectOptions(filterId)[0]?.value ?? "";
        next[filterId] = firstOption;
        return next;
      }

      next[filterId] = "";
      return next;
    });
    setIsFilterMenuOpen(false);
  }

  function handleRemoveAdvancedFilter(filterId: ProductAdvancedFilterId) {
    setAdvancedFilterDraft((current) =>
      removeAdvancedFilterFromDraft(current, filterId)
    );
  }

  function handleClearFilters() {
    const emptyDraft: AdvancedFilterDraft = {};
    setAdvancedFilterDraft(emptyDraft);
    applyProductSearchAndFilters("push", {
      advancedDraft: emptyDraft,
      productFilterOverride: "all",
    });
  }

  function handleAdvancedFilterKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    applyProductSearchAndFilters("push");
  }

  function updateAdvancedFilterDraftValue(key: string, value: string) {
    setAdvancedFilterDraft((current) => ({
      ...current,
      [key]: value,
    }));
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
            type="text"
            inputMode="decimal"
            value={advancedFilterDraft[keys.min] ?? ""}
            onChange={(event) =>
              updateAdvancedFilterDraftValue(keys.min, event.target.value)
            }
            onKeyDown={handleAdvancedFilterKeyDown}
            placeholder="Min"
            className="h-8 w-20 rounded border border-gray-300 px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          />
          <input
            type="text"
            inputMode="decimal"
            value={advancedFilterDraft[keys.max] ?? ""}
            onChange={(event) =>
              updateAdvancedFilterDraftValue(keys.max, event.target.value)
            }
            onKeyDown={handleAdvancedFilterKeyDown}
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
          value={advancedFilterDraft[filterId] ?? ""}
          onChange={(event) =>
            updateAdvancedFilterDraftValue(filterId, event.target.value)
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
        value={advancedFilterDraft[filterId] ?? ""}
        onChange={(event) =>
          updateAdvancedFilterDraftValue(filterId, event.target.value)
        }
        onKeyDown={handleAdvancedFilterKeyDown}
        placeholder={filter.label}
        className="h-8 w-44 rounded border border-gray-300 px-2 text-xs text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
      />
    );
  }

  const activeAdvancedFilters = PRODUCT_ADVANCED_FILTERS.filter((filter) =>
    isAdvancedFilterActive(filter.id)
  );
  const hasPendingProductQueryChanges =
    searchDraft.trim() !== searchQuery ||
    getAdvancedFilterDraftSignature(advancedFilterDraft) !==
      getAdvancedFilterDraftSignature(appliedAdvancedFilterDraft);
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

  const handleCopyTitles = async () => {
    if (selectedProductIds.length === 0) return;

    const selectedSet = new Set(selectedProductIds);
    const titles = selectionProducts
      .filter((p) => selectedSet.has(p.id))
      .map((p) => p.title.trim())
      .filter(Boolean)
      .join("\n");

    if (!titles) {
      showToast("No titles found for the selected products.", "error");
      return;
    }

    setIsCopyingTitles(true);

    try {
      await navigator.clipboard.writeText(titles);
      showToast(
        `Copied ${selectedProductIds.length} title${selectedProductIds.length === 1 ? "" : "s"} to clipboard.`,
        "success"
      );
    } catch {
      showToast("Failed to copy to clipboard. Check browser permissions.", "error");
    } finally {
      setIsCopyingTitles(false);
    }
  };

  const handleSyncEbayAds = async (productIds?: string[]) => {
    const scopedProductIds = productIds?.filter(Boolean) ?? [];
    const isSelectedSync = scopedProductIds.length > 0;

    setIsSyncingEbayAds(true);
    setEbayAdsSyncProgress({
      ...INITIAL_EBAY_ADS_SYNC_PROGRESS,
      phase: isSelectedSync
        ? "Starting selected eBay ad sync"
        : INITIAL_EBAY_ADS_SYNC_PROGRESS.phase,
      total: isSelectedSync ? scopedProductIds.length : 0,
    });

    try {
      const response = await fetch("/api/ebay/promoted-listings/sync", {
        method: "POST",
        headers: isSelectedSync
          ? { "Content-Type": "application/json" }
          : undefined,
        body: isSelectedSync
          ? JSON.stringify({ productIds: scopedProductIds })
          : undefined,
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Failed to sync eBay ads.");
      }

      let finalProgress: EbayAdsSyncProgress | null = null;
      const contentType = response.headers.get("content-type") ?? "";

      if (response.body && contentType.includes("application/x-ndjson")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
              continue;
            }

            const progress = JSON.parse(trimmedLine) as EbayAdsSyncProgress;
            finalProgress = progress;
            setEbayAdsSyncProgress(progress);

            if (progress.type === "error") {
              throw new Error(progress.error || "Failed to sync eBay ads.");
            }
          }
        }

        const trailingLine = buffer.trim();
        if (trailingLine) {
          const progress = JSON.parse(trailingLine) as EbayAdsSyncProgress;
          finalProgress = progress;
          setEbayAdsSyncProgress(progress);

          if (progress.type === "error") {
            throw new Error(progress.error || "Failed to sync eBay ads.");
          }
        }
      } else {
        const data = (await response.json().catch(() => ({}))) as Partial<
          EbayAdsSyncProgress
        >;

        finalProgress = {
          ...INITIAL_EBAY_ADS_SYNC_PROGRESS,
          ...data,
          type: "done",
          phase: "eBay ad sync complete",
          percent: 100,
        };
        setEbayAdsSyncProgress(finalProgress);
      }

      router.refresh();
      showToast(
        `Synced eBay ads for ${finalProgress?.total ?? 0} ${
          isSelectedSync ? "selected " : ""
        }listing${finalProgress?.total === 1 ? "" : "s"}. ${
          finalProgress?.promoted ?? 0
        } promoted, ${finalProgress?.notPromoted ?? 0} not promoted.`,
        "success",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync eBay ads.";
      setEbayAdsSyncProgress((current) => ({
        ...(current ?? INITIAL_EBAY_ADS_SYNC_PROGRESS),
        type: "error",
        phase: "eBay ad sync failed",
        error: message,
      }));
      showToast(
        message,
        "error",
      );
    } finally {
      setIsSyncingEbayAds(false);
    }
  };

  const startPriceCheckJob = useCallback(
    async (productIds?: string[]) => {
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
              ? "Price check is queued."
              : skippedSelectedMessage
                ? `Price check queued for ${data.job.total} product${
                    data.job.total === 1 ? "" : "s"
                  }. ${skippedSelectedMessage}`
                : `Price check queued for ${data.job.total} product${data.job.total === 1 ? "" : "s"}.`,
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
    [applyPriceCheckJob, products, showToast]
  );

  const handleCheckPrices = () => {
    void startPriceCheckJob(
      selectedHasNoEligiblePriceChecks ? undefined : selectedProductIds
    );
  };
  const isPriceCheckJobStopping = isCancellingPriceCheckJob;
  const isPriceCheckJobResumable = isResumablePriceCheckJob(priceCheckJob);
  const priceCheckProgressPercent = priceCheckJob?.total
    ? Math.min(100, Math.round((priceCheckJob.checked / priceCheckJob.total) * 100))
    : 0;
  const promotionProgressPercent = promotedListingsJob?.total
    ? Math.min(
        100,
        Math.round(
          (promotedListingsJob.processed / promotedListingsJob.total) * 100,
        ),
      )
    : 0;

  const openPromotedListings = (productIds: string[]) => {
    setSelectedProductIds(productIds);
    if (
      promotedListingsJob &&
      !isActivePromotedListingsJob(promotedListingsJob)
    ) {
      setPromotedListingsJob(null);
    }
    setIsPromotedListingsOpen(true);
  };

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
              <>
                <button
                  type="button"
                  onClick={() => cancelActivePriceCheckJob(false)}
                  disabled={isPriceCheckJobStopping}
                  className="rounded-md border border-quaternary bg-white px-3 py-1.5 text-sm font-medium text-quaternary transition-colors hover:bg-quaternary-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPriceCheckJobStopping
                    ? "Stopping..."
                    : priceCheckJob?.status === "CANCELLING"
                      ? "Stopping..."
                      : "Stop"}
                </button>
                <button
                  type="button"
                  onClick={() => cancelActivePriceCheckJob(true)}
                  disabled={isPriceCheckJobStopping}
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Force Stop
                </button>
              </>
            )}
            {isPriceCheckJobResumable && (
              <>
                <button
                  type="button"
                  onClick={resumeCancelledPriceCheckJob}
                  disabled={isResumingPriceCheckJob}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResumingPriceCheckJob ? "Resuming..." : "Resume"}
                </button>
                <button
                  type="button"
                  onClick={() => void dismissPriceCheckJob()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Dismiss
                </button>
              </>
            )}
            {!isPriceCheckJobResumable && isTerminalPriceCheckJob(priceCheckJob) && (
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

      {promotedListingsJob && !isPromotedListingsOpen && (
        <div
          className={`mb-4 rounded-md border px-4 py-3 ${
            promotedListingsJob.failed > 0 ||
            promotedListingsJob.status === "FAILED"
              ? "border-red-200 bg-red-50"
              : isPromotionJobActive
                ? "border-blue-200 bg-blue-50"
                : "border-green-200 bg-green-50"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[260px] flex-1">
              <ActionProgressBar
                label={
                  promotedListingsJob.status === "QUEUED"
                    ? "Promotion changes queued - waiting for worker"
                    : promotedListingsJob.status === "RUNNING"
                      ? "Updating eBay promoted listings"
                      : promotedListingsJob.status === "COMPLETED"
                        ? "Promotion job complete"
                        : "Promotion job failed"
                }
                percent={promotionProgressPercent}
                detail={`${promotedListingsJob.processed}/${promotedListingsJob.total} processed, ${promotedListingsJob.succeeded} succeeded, ${promotedListingsJob.failed} failed`}
                tone={
                  promotedListingsJob.failed > 0 ||
                  promotedListingsJob.status === "FAILED"
                    ? "red"
                    : isPromotionJobActive
                      ? "blue"
                      : "green"
                }
              />
            </div>
            <button
              ref={filterMenuButtonRef}
              type="button"
              onClick={() => setIsPromotedListingsOpen(true)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View
            </button>
            {!isPromotionJobActive && (
              <button
                type="button"
                onClick={() => setPromotedListingsJob(null)}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
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
              setIsSearchSuggestionsOpen(false);
              setActiveSearchSuggestionIndex(-1);
              applyProductSearchAndFilters("push");
            }}
            className="flex w-full items-center gap-2 sm:w-auto"
          >
            <div
              ref={searchContainerRef}
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
                ref={searchInputRef}
                type="text"
                value={searchDraft}
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  setIsSearchSuggestionsOpen(true);
                  setActiveSearchSuggestionIndex(-1);
                }}
                onFocus={() => {
                  if (searchDraft.trim().length >= 2) {
                    setIsSearchSuggestionsOpen(true);
                  }
                }}
                onKeyDown={handleSearchInputKeyDown}
                placeholder="Search products, IDs, ASIN..."
                aria-label="Search products"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="product-search-suggestions"
                aria-expanded={isSearchSuggestionsOpen}
                className="h-10 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft("");
                    setSearchSuggestions([]);
                    setIsSearchSuggestionsOpen(false);
                    setActiveSearchSuggestionIndex(-1);
                    applyProductSearchAndFilters("push", { search: "" });
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
              {isSearchSuggestionsOpen && searchDraft.trim().length >= 2 && (
                <div
                  id="product-search-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
                >
                  {isLoadingSearchSuggestions ? (
                    <div className="px-3 py-3 text-sm text-gray-500">
                      Searching products...
                    </div>
                  ) : searchSuggestions.length > 0 ? (
                    searchSuggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        role="option"
                        aria-selected={index === activeSearchSuggestionIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSearchSuggestion(suggestion)}
                        onMouseEnter={() => setActiveSearchSuggestionIndex(index)}
                        className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 ${
                          index === activeSearchSuggestionIndex
                            ? "bg-orange-50"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {suggestion.image ? (
                          <Image
                            src={suggestion.image}
                            alt=""
                            width={40}
                            height={40}
                            unoptimized
                            className="h-10 w-10 flex-none rounded border border-gray-100 object-cover"
                          />
                        ) : (
                          <span className="h-10 w-10 flex-none rounded bg-gray-100" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {suggestion.title}
                          </span>
                          <span className="block truncate text-xs text-gray-500">
                            {[
                              suggestion.asin ? `ASIN ${suggestion.asin}` : null,
                              suggestion.ebayItemId
                                ? `eBay ${suggestion.ebayItemId}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join("  |  ") || "ListFlow product"}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-gray-500">
                      No matching products
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-md bg-gray-900 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700"
            >
              Search
            </button>
          </form>
          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsFilterMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isFilterMenuOpen}
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
              <div
                role="menu"
                className="absolute left-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-md border border-gray-200 bg-white py-2 shadow-lg"
              >
                {PRODUCT_ADVANCED_FILTERS.map((filter) => {
                  const active = isAdvancedFilterActive(filter.id);
                  const disabled = !filter.enabled || active;

                  return (
                    <button
                      key={filter.id}
                      type="button"
                      role="menuitem"
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
          <div className="inline-flex max-w-full overflow-x-auto no-scrollbar rounded-md border border-gray-300 bg-white shadow-sm whitespace-nowrap">
            {PRODUCT_FILTER_OPTIONS.map((option) => {
              const selected = option.value === displayedProductFilter;
              const loading =
                isProductFilterPending && option.value === pendingProductFilter;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleProductFilterChange(option.value)}
                  aria-pressed={selected}
                  disabled={isProductFilterPending}
                  className={`border-r border-gray-300 px-3 py-2 text-sm font-medium transition-colors last:border-r-0 ${
                    selected
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-50"
                  } disabled:cursor-wait disabled:opacity-80`}
                >
                  {loading && (
                    <span
                      className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white align-[-1px]"
                      aria-hidden="true"
                    />
                  )}
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
            type="button"
            onClick={() => void handleSyncEbayAds()}
            disabled={isSyncingEbayAds}
            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m14.356-2A8 8 0 006.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 017.64 15m11.778 0H15"
              />
            </svg>
            {isSyncingEbayAds ? "Syncing Ads..." : "Sync eBay Ads"}
          </button>

          <button
            onClick={handleCheckPrices}
            disabled={isStartingPriceCheckJob}
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
                ? "Queue Price Check"
              : selectedHasNoEligiblePriceChecks
                ? "Check All Trackable"
              : selectedProductIds.length > 0
                ? selectedPriceCheckSummary.eligibleCount > 0
                  ? `Check ${selectedPriceCheckSummary.eligibleCount} Selected`
                  : "Check Selected"
                : "Check Prices Now"}
          </button>
          {selectedProductIds.length > 0 && (
            <button
              type="button"
              onClick={() => void handleCopyTitles()}
              disabled={isCopyingTitles}
              title="Copy selected product titles to clipboard for eBay Research"
              className="inline-flex items-center gap-2 rounded-md border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {isCopyingTitles
                ? "Copying..."
                : `Copy ${selectedProductIds.length} Title${selectedProductIds.length === 1 ? "" : "s"}`}
            </button>
          )}
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

      {ebayAdsSyncProgress && (
        <div
          className={`mb-4 rounded-md border p-3 ${
            ebayAdsSyncProgress.type === "error"
              ? "border-red-200 bg-red-50"
              : ebayAdsSyncProgress.type === "done"
                ? "border-emerald-200 bg-emerald-50"
                : "border-blue-100 bg-blue-50"
          }`}
        >
          <ActionProgressBar
            label={ebayAdsSyncProgress.phase}
            percent={ebayAdsSyncProgress.percent}
            tone={
              ebayAdsSyncProgress.type === "error"
                ? "red"
                : ebayAdsSyncProgress.type === "done"
                  ? "green"
                  : "blue"
            }
            detail={getEbayAdsSyncDetail(ebayAdsSyncProgress)}
          />
        </div>
      )}

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
            onClick={() => applyProductSearchAndFilters("push")}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              hasPendingProductQueryChanges
                ? "bg-gray-900 text-white hover:bg-gray-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Search
          </button>
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
        totalListingCount={totalCount}
        allSelectionProducts={allSelectionProducts}
        selectionScopeKey={selectionScopeKey}
        onSelectAllListings={loadAllSelectionProducts}
        isSelectAllListingsLoading={isLoadingAllSelection}
        onToast={showToast}
        view="products"
        sortBy={sortBy}
        sortOrder={sortOrder}
        isSortPending={isProductSortPending}
        onSortChange={handleProductSortChange}
        autoExpandProductId={focusedProductId}
        onSelectionChange={setSelectedProductIds}
        onPriceCheckSelected={startPriceCheckJob}
        onSyncSelectedEbayAds={handleSyncEbayAds}
        isEbayAdsSyncing={isSyncingEbayAds}
        onManagePromotionsSelected={openPromotedListings}
        isPromotionJobActive={isPromotionJobActive}
        onBulkEditSelected={(ids) => {
          setSelectedProductIds(ids);
          setIsBulkEditOpen(true);
        }}
      />

      <BulkEditModal
        open={isBulkEditOpen}
        storeId={selectionProducts[0]?.storeId ?? null}
        selectedProductIds={selectedProductIds}
        onClose={() => setIsBulkEditOpen(false)}
        onToast={showToast}
      />

      <PromotedListingsModal
        open={isPromotedListingsOpen}
        selectedProductIds={selectedProductIds}
        selectedProducts={selectedProducts}
        job={promotedListingsJob}
        onClose={() => setIsPromotedListingsOpen(false)}
        onJobStarted={(job) => applyPromotedListingsJob(job)}
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
          <form
            onSubmit={handlePageJumpSubmit}
            className="flex items-center gap-2"
          >
            <label htmlFor="products-page-jump" className="text-gray-500">
              Go to
            </label>
            <input
              id="products-page-jump"
              type="number"
              min={1}
              max={totalPages}
              value={pageJumpDraft}
              onChange={(event) => setPageJumpDraft(event.target.value)}
              className="h-9 w-20 rounded-md border border-gray-300 px-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              aria-label="Go to products page"
            />
            <button
              type="submit"
              disabled={totalPages <= 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Go
            </button>
          </form>
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
