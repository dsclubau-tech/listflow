/* eslint-disable @next/next/no-img-element */
"use client";

import {
  Fragment,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import AsinLink from "@/components/AsinLink";
import ActionProgressBar from "@/components/ActionProgressBar";
import Button from "@/components/ui/Button";
import { hasMissingItemSpecifics } from "@/components/draft-upload-response";
import InlineEditForm from "@/components/InlineEditForm";
import {
  getPriceCheckEligibility,
  getSelectedPriceCheckSummary,
} from "@/lib/price-check-eligibility";
import { getProductDisplayProfitBreakdown } from "@/lib/product-profit";
import {
  getAmazonPriceTrackingLabel,
  normalizeAmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { getStoreBadgeClass } from "@/lib/store-badge";
import {
  getProductDisplaySellPrices,
  type ProductSortField,
  type ProductSortOrder,
} from "@/lib/product-sort";
import {
  hasEverySelected,
  setPageSelection,
} from "@/lib/product-selection";
import type { ProductSelectionSummary } from "@/types/product-selection";
import type { SerializedProductRow } from "@/types/product-row";

interface DraftsTableProps {
  products: SerializedProductRow[];
  totalListingCount?: number;
  allSelectionProducts?: ProductSelectionSummary[] | null;
  selectionScopeKey?: string;
  onSelectAllListings?: () => Promise<ProductSelectionSummary[]>;
  isSelectAllListingsLoading?: boolean;
  onToast: (message: string, variant: "success" | "error") => void;
  view?: "drafts" | "products";
  sortBy?: ProductSortField | null;
  sortOrder?: ProductSortOrder;
  isSortPending?: boolean;
  onSortChange?: (sortBy: ProductSortField) => void;
  autoExpandProductId?: string | null;
  onSelectionChange?: (selectedIds: string[]) => void;
  onPriceCheckSelected?: (productIds: string[]) => Promise<void>;
  onSyncSelectedEbayAds?: (productIds: string[]) => Promise<void>;
  isEbayAdsSyncing?: boolean;
  onManagePromotionsSelected?: (productIds: string[]) => void;
  isPromotionJobActive?: boolean;
  onBulkEditSelected?: (productIds: string[]) => void;
  onDraftImported?: (productId: string) => void;
}

type UploadJobError = {
  productId: string;
  title: string;
  error: string;
};

type UploadJob = {
  id: string;
  type: string;
  status: string;
  productIds: string[];
  completedProductIds: string[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: UploadJobError[];
  queuePosition: number | null;
};

function isActiveUploadJob(job: UploadJob) {
  return job.status === "QUEUED" || job.status === "RUNNING";
}

function getUploadJobPercent(job: UploadJob) {
  return job.total > 0
    ? Math.min(100, Math.round((job.processed / job.total) * 100))
    : 0;
}

const statusBadgeLabels: Record<string, string> = {
  DRAFT: "Draft",
  IMPORTED: "Imported",
  FAILED: "Failed",
  ON_HOLD: "On Hold",
};

function getProductHoldReason(product: Pick<SerializedProductRow, "status" | "holdReason" | "priceCheckError" | "amazonStockLeft" | "quantity">) {
  if (product.status !== "ON_HOLD") {
    return null;
  }
  const explicitReason = product.holdReason?.trim();
  if (explicitReason) {
    return explicitReason;
  }
  const priceCheckError = product.priceCheckError?.trim();
  if (priceCheckError) {
    return `Automatic hold after failed price check: ${priceCheckError}`;
  }
  if (product.quantity <= 0) {
    return "Listing quantity was set to 0.";
  }
  if (
    product.amazonStockLeft !== null &&
    product.amazonStockLeft !== undefined &&
    product.amazonStockLeft <= 3
  ) {
    return `Low Amazon stock (${product.amazonStockLeft} left).`;
  }
  return "Put on hold manually.";
}

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "A$0.00";
  }

  const parsed = typeof value === "number" ? value : Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;

  return `A$${amount.toFixed(2)}`;
}

function parseMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoneyRange(values: number[]) {
  if (values.length === 0) {
    return "-";
  }

  const sorted = [...values].sort((left, right) => left - right);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  if (min === max) {
    return formatMoney(min);
  }

  return `${formatMoney(min)} - ${formatMoney(max)}`;
}

function formatChangePercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PlatformIcon({ platform }: { platform: "amazon" | "ebay" }) {
  if (platform === "amazon") {
    return (
      <span
        aria-hidden="true"
        className="relative inline-flex h-5 w-6 shrink-0 items-start justify-center overflow-hidden rounded-md bg-[#131921] pt-0.5 text-[11px] font-bold leading-none text-white shadow-sm ring-1 ring-black/10"
      >
        a
        <svg
          className="absolute bottom-0.5 left-1 h-2 w-4 text-[#ff9900]"
          viewBox="0 0 16 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 1.5c3.4 2.5 7.5 3.1 11.7 1.4" />
          <path d="m11.4 1.8 2.2.8-1 2" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-[8px] font-black leading-none tracking-[-0.1em] shadow-sm ring-1 ring-gray-200"
    >
      <span className="text-[#e53238]">e</span>
      <span className="text-[#0064d2]">b</span>
      <span className="text-[#f5af02]">a</span>
      <span className="text-[#86b817]">y</span>
    </span>
  );
}

function ExternalLinkGlyph({ platform }: { platform: "amazon" | "ebay" }) {
  return (
    <svg
      aria-hidden="true"
      className={
        platform === "amazon"
          ? "h-3 w-3 shrink-0 text-gray-300 transition-colors group-hover:text-orange-500"
          : "h-3 w-3 shrink-0 text-gray-300 transition-colors group-hover:text-blue-500"
      }
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-6 3L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function ItemIdCell({ product }: { product: SerializedProductRow }) {
  const asin = product.asin?.trim();
  const ebayItemId = product.ebayItemId?.trim();

  return (
    <div className="space-y-1 text-xs">
      {asin ? (
        <AsinLink
          asin={asin}
          stopPropagation
          aria-label={`Open Amazon product ${asin}`}
          className="group -ml-1 inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 text-gray-700 transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
        >
          <PlatformIcon platform="amazon" />
          <span className="min-w-0 flex-1 truncate font-mono font-medium">
            {asin.toUpperCase()}
          </span>
          <ExternalLinkGlyph platform="amazon" />
        </AsinLink>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
          <PlatformIcon platform="amazon" />
          <span className="text-gray-400">-</span>
        </div>
      )}
      {ebayItemId ? (
        <a
          href={`https://www.ebay.com.au/itm/${ebayItemId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="group -ml-1 inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 text-gray-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
          title={`Open eBay item ${ebayItemId}`}
          aria-label={`Open eBay item ${ebayItemId}`}
        >
          <PlatformIcon platform="ebay" />
          <span className="min-w-0 flex-1 truncate font-mono font-medium">
            {ebayItemId}
          </span>
          <ExternalLinkGlyph platform="ebay" />
        </a>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
          <PlatformIcon platform="ebay" />
          <span className="text-gray-400">-</span>
        </div>
      )}
    </div>
  );
}

function PriceCell({ product }: { product: SerializedProductRow }) {
  const variants = product.variants ?? [];
  const buyPrices = variants
    .map((variant) => parseMoney(variant.buyPrice))
    .filter((value): value is number => value !== null);
  const sellPrices = getProductDisplaySellPrices(product);
  const fallbackBuyPrice = parseMoney(product.amazonPrice ?? product.price);
  const fallbackSellPrice = parseMoney(product.price);
  const hasAmazonTracking = Boolean(product.asin);
  const amazonPriceTrackingMode = normalizeAmazonPriceTrackingMode(
    (product as { amazonPriceTrackingMode?: unknown }).amazonPriceTrackingMode
  );

  return (
    <div className="min-w-0 space-y-1 text-xs font-medium leading-5">
      <div className="max-w-full whitespace-normal break-words">
        <span className="text-gray-500">BUY</span>{" "}
        <span className="font-semibold text-gray-900">
          {formatMoneyRange(
            buyPrices.length > 0
              ? buyPrices
              : fallbackBuyPrice !== null
                ? [fallbackBuyPrice]
                : []
          )}
        </span>
      </div>
      {hasAmazonTracking && (
        <div className="text-[11px] font-medium text-gray-500">
          {getAmazonPriceTrackingLabel(amazonPriceTrackingMode)}
        </div>
      )}
      <div className="max-w-full whitespace-normal break-words">
        <span className="text-gray-500">SELL</span>{" "}
        <span className="font-semibold text-gray-900">
          {formatMoneyRange(
            sellPrices.length > 0
              ? sellPrices
              : fallbackSellPrice !== null
                ? [fallbackSellPrice]
                : []
          )}
        </span>
      </div>
    </div>
  );
}

function ProfitCell({ product }: { product: SerializedProductRow }) {
  const breakdown = getProductDisplayProfitBreakdown(product);

  if (breakdown.length === 0) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const profits = breakdown.map((item) => item.profit);
  const profitsAfterAdFee = breakdown
    .map((item) => item.profitAfterAdFee)
    .filter((profit): profit is number => profit !== null);
  const hasNegativeProfit = profits.some((profit) => profit < 0);
  const hasUnknownAdProfit = profitsAfterAdFee.length !== breakdown.length;
  const hasNegativeAdProfit = profitsAfterAdFee.some((profit) => profit < 0);

  return (
    <div className="max-w-full space-y-0.5 whitespace-normal text-xs leading-4">
      <div>
        <span className="text-gray-500">PROFIT</span>{" "}
        <span
          className={`font-semibold ${
            hasNegativeProfit ? "text-red-700" : "text-gray-900"
          }`}
        >
          {formatMoneyRange(profits)}
        </span>
      </div>
      <div
        title={
          hasUnknownAdProfit
            ? "Sync eBay Ads to calculate profit after the promoted-ad fee. Dynamic campaigns do not expose a fixed fee rate."
            : "Profit after the current promoted-ad fee"
        }
      >
        <span className="text-gray-500">AFTER AD</span>{" "}
        <span
          className={`font-semibold ${
            hasNegativeAdProfit ? "text-red-700" : "text-gray-900"
          }`}
        >
          {hasUnknownAdProfit ? "-" : formatMoneyRange(profitsAfterAdFee)}
        </span>
      </div>
    </div>
  );
}

function ProductSortHeader({
  label,
  field,
  sortBy,
  sortOrder,
  isSortPending,
  onSortChange,
}: {
  label: string;
  field: ProductSortField;
  sortBy: ProductSortField | null;
  sortOrder: ProductSortOrder;
  isSortPending: boolean;
  onSortChange?: (sortBy: ProductSortField) => void;
}) {
  const isActive = sortBy === field;
  const nextOrder = isActive && sortOrder === "asc" ? "descending" : "ascending";

  return (
    <th
      className="px-3 py-3 text-left"
      aria-sort={
        isActive ? (sortOrder === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSortChange?.(field)}
        disabled={isSortPending || !onSortChange}
        aria-label={`Sort ${label.toLowerCase()} ${nextOrder}`}
        title={`Sort ${label.toLowerCase()} ${nextOrder}`}
        className="group inline-flex items-center gap-1.5 rounded-sm text-left transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={
            isActive
              ? "text-orange-600"
              : "text-gray-400 group-hover:text-gray-600"
          }
        >
          {isActive ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function getAmazonChangeDetail(product: SerializedProductRow) {
  const lastHistory = product.priceHistory?.[0] ?? null;

  if (!lastHistory) {
    return "Amazon price change is waiting for review.";
  }

  const currentAmazonPrice = parseMoney(product.amazonPrice);
  const changeRatio = 1 + lastHistory.changePercent / 100;
  const previousAmazonPrice =
    currentAmazonPrice !== null &&
    Number.isFinite(changeRatio) &&
    Math.abs(changeRatio) > 0.000001
      ? currentAmazonPrice / changeRatio
      : null;

  if (previousAmazonPrice === null || currentAmazonPrice === null) {
    return `Amazon change ${formatChangePercent(lastHistory.changePercent)} is waiting for review.`;
  }

  return `Amazon: ${formatMoney(previousAmazonPrice)} -> ${formatMoney(currentAmazonPrice)} (${formatChangePercent(lastHistory.changePercent)})`;
}

function getPriceTrackingState(product: SerializedProductRow) {
  const variantCount = product._count?.variants ?? 0;
  const lastHistory = product.priceHistory?.[0] ?? null;

  if (!product.asin || variantCount === 0) {
    return {
      label: "Not tracked",
      badgeClass: "bg-gray-100 text-gray-600",
      priceHistoryId: null,
      detail: !product.asin
        ? "Add an Amazon ASIN to track this listing."
        : "Add at least one variant to enable price tracking.",
    };
  }

  if (product.priceCheckError) {
    return {
      label: "Check failed",
      badgeClass: "bg-red-100 text-red-700",
      priceHistoryId: null,
      detail: product.priceCheckError,
    };
  }

  if (lastHistory && !lastHistory.appliedAt) {
    return {
      label: "Pending review",
      badgeClass: "bg-amber-100 text-amber-800",
      priceHistoryId: lastHistory.id,
      detail: getAmazonChangeDetail(product),
    };
  }

  if (product.lastPriceCheck) {
    return {
      label: "No change",
      badgeClass: "bg-emerald-100 text-emerald-700",
      priceHistoryId: null,
      detail: `Checked ${formatDateTime(product.lastPriceCheck) ?? "recently"}`,
    };
  }

  return {
    label: "Awaiting check",
    badgeClass: "bg-gray-100 text-gray-600",
    priceHistoryId: null,
    detail: "Tracked product has not been checked yet.",
  };
}

function getPromotedAdState(product: SerializedProductRow) {
  const status = String(product.promotedAdStatus ?? "UNKNOWN");
  const strategy = String(product.promotedAdRateStrategy ?? "UNKNOWN");
  const syncedAt = formatDateTime(product.promotedAdSyncedAt);
  const campaignName = product.promotedAdCampaignName?.trim() ?? "";
  const detailParts = [
    campaignName ? `Campaign: ${campaignName}` : null,
    syncedAt ? `Synced ${syncedAt}` : null,
  ].filter(Boolean);
  const detail =
    detailParts.length > 0
      ? detailParts.join(" | ")
      : "Run Sync eBay Ads to refresh promoted listing data.";

  if (status === "PROMOTED") {
    if (strategy === "DYNAMIC") {
      return {
        label: "Promoted dynamic",
        badgeClass: "bg-emerald-100 text-emerald-700",
        detail,
      };
    }

    const adRate = formatPercent(product.promotedAdPercent);

    return {
      label: adRate ? `Promoted ${adRate}%` : "Promoted",
      badgeClass: "bg-emerald-100 text-emerald-700",
      detail,
    };
  }

  if (status === "NOT_PROMOTED") {
    return {
      label: "Not promoted",
      badgeClass: "bg-gray-100 text-gray-600",
      detail,
    };
  }

  return {
    label: "Not synced",
    badgeClass: "bg-amber-100 text-amber-700",
    detail,
  };
}

type SelectionProduct = SerializedProductRow | ProductSelectionSummary;

function canCheckProductPrice(product: SelectionProduct) {
  return getPriceCheckEligibility(product).eligible;
}

function hasPendingPriceChange(product: SelectionProduct) {
  if ("hasPendingPriceChange" in product) {
    return product.hasPendingPriceChange;
  }

  return Boolean(product.priceHistory?.some((entry) => !entry.appliedAt));
}

export default function DraftsTable({
  products,
  totalListingCount = products.length,
  allSelectionProducts = null,
  selectionScopeKey = "",
  onSelectAllListings,
  isSelectAllListingsLoading = false,
  onToast,
  view = "drafts",
  sortBy = null,
  sortOrder = "asc",
  isSortPending = false,
  onSortChange,
  autoExpandProductId = null,
  onSelectionChange,
  onPriceCheckSelected,
  onSyncSelectedEbayAds,
  isEbayAdsSyncing = false,
  onManagePromotionsSelected,
  isPromotionJobActive = false,
  onBulkEditSelected,
  onDraftImported,
}: DraftsTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<
    Record<string, SerializedProductRow>
  >({});
  const [loadingProductDetailIds, setLoadingProductDetailIds] = useState<
    string[]
  >([]);
  const [productDetailErrors, setProductDetailErrors] = useState<
    Record<string, string>
  >({});
  const productDetailRequests = useRef<Map<string, Promise<void>>>(new Map());
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const previousSelectionScopeKey = useRef(selectionScopeKey);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectingAllListings, setIsSelectingAllListings] = useState(false);
  const tableScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isTableDragging, setIsTableDragging] = useState(false);
  const dragScrollState = useRef({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  });

  const handleTableMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = tableScrollContainerRef.current;
    if (!container) return;

    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "button, a, input, select, textarea, [role='menu'], [role='dialog'], [data-no-drag]",
      )
    ) {
      return;
    }

    dragScrollState.current = {
      isDown: true,
      startX: e.pageX - container.offsetLeft,
      scrollLeft: container.scrollLeft,
      moved: false,
    };
  }, []);

  const handleTableMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = tableScrollContainerRef.current;
    if (!container || !dragScrollState.current.isDown) return;

    const x = e.pageX - container.offsetLeft;
    const walk = x - dragScrollState.current.startX;

    if (Math.abs(walk) > 4) {
      if (!dragScrollState.current.moved) {
        dragScrollState.current.moved = true;
        setIsTableDragging(true);
      }
      container.scrollLeft = dragScrollState.current.scrollLeft - walk;
    }
  }, []);

  const handleTableMouseUpOrLeave = useCallback(() => {
    dragScrollState.current.isDown = false;
    if (dragScrollState.current.moved) {
      dragScrollState.current.moved = false;
      setIsTableDragging(false);
    }
  }, []);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkPriceChecking, setIsBulkPriceChecking] = useState(false);
  const [reviewingPriceHistoryId, setReviewingPriceHistoryId] =
    useState<string | null>(null);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [isBulkDismissing, setIsBulkDismissing] = useState(false);
  const [isBulkResuming, setIsBulkResuming] = useState(false);
  const [isBulkHolding, setIsBulkHolding] = useState(false);
  const [isBulkEnding, setIsBulkEnding] = useState(false);
  const [isBulkRemovingListflow, setIsBulkRemovingListflow] = useState(false);
  const [notingProduct, setNotingProduct] =
    useState<SerializedProductRow | null>(null);
  const [removalProduct, setRemovalProduct] =
    useState<SerializedProductRow | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    product: SerializedProductRow;
    x: number;
    y: number;
  } | null>(null);
  const [draftActionMenuProductId, setDraftActionMenuProductId] = useState<
    string | null
  >(null);
  const draftActionMenuTriggerRefs = useRef<Map<string, HTMLButtonElement>>(
    new Map(),
  );
  const previousActiveUploadJobIds = useRef<Set<string>>(new Set());
  const didInitializeUploadJobs = useRef(false);
  const router = useRouter();

  const isDraftsView = view === "drafts";
  const isProductsView = view === "products";
  const hasSelectionColumn = isDraftsView || isProductsView;
  const activeUploadJobs = useMemo(
    () => uploadJobs.filter(isActiveUploadJob),
    [uploadJobs],
  );
  const uploadJobByProductId = useMemo(() => {
    const jobsByProductId = new Map<string, UploadJob>();

    for (const job of activeUploadJobs) {
      for (const productId of job.productIds) {
        if (!jobsByProductId.has(productId)) {
          jobsByProductId.set(productId, job);
        }
      }
    }

    return jobsByProductId;
  }, [activeUploadJobs]);

  const hasCurrentProductDetails = useCallback(
    (productId: string) => {
      const summary = products.find((product) => product.id === productId);
      const details = productDetails[productId];
      return Boolean(
        summary && details && summary.updatedAt === details.updatedAt
      );
    },
    [productDetails, products]
  );

  const loadProductDetails = useCallback(async (productId: string) => {
    const activeRequest = productDetailRequests.current.get(productId);
    if (activeRequest) {
      return activeRequest;
    }

    const request = (async () => {
      setLoadingProductDetailIds((current) =>
        current.includes(productId) ? current : [...current, productId]
      );
      setProductDetailErrors((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });

      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as
          | SerializedProductRow
          | { error?: string };

        if (!response.ok || !("id" in data)) {
          throw new Error(
            "error" in data && data.error
              ? data.error
              : "Failed to load product details."
          );
        }

        setProductDetails((current) => ({ ...current, [productId]: data }));
      } catch (error) {
        setProductDetailErrors((current) => ({
          ...current,
          [productId]:
            error instanceof Error
              ? error.message
              : "Failed to load product details.",
        }));
      } finally {
        setLoadingProductDetailIds((current) =>
          current.filter((id) => id !== productId)
        );
        productDetailRequests.current.delete(productId);
      }
    })();

    productDetailRequests.current.set(productId, request);
    return request;
  }, []);

  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [onSelectionChange, selectedIds]);

  const loadUploadJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/upload/jobs/current", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        jobs?: UploadJob[];
      };

      if (response.ok && Array.isArray(data.jobs)) {
        setUploadJobs(data.jobs);
      }
    } catch {
      // Draft editing remains available if progress polling is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    if (!isDraftsView) {
      return;
    }

    void loadUploadJobs();
  }, [isDraftsView, loadUploadJobs]);

  useEffect(() => {
    if (!isDraftsView || activeUploadJobs.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadUploadJobs();
      router.refresh();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [activeUploadJobs.length, isDraftsView, loadUploadJobs, router]);

  useEffect(() => {
    const currentActiveIds = new Set(activeUploadJobs.map((job) => job.id));

    if (!didInitializeUploadJobs.current) {
      previousActiveUploadJobIds.current = currentActiveIds;
      didInitializeUploadJobs.current = true;
      return;
    }

    for (const previousJobId of previousActiveUploadJobIds.current) {
      if (currentActiveIds.has(previousJobId)) {
        continue;
      }

      const completedJob = uploadJobs.find((job) => job.id === previousJobId);
      if (!completedJob || isActiveUploadJob(completedJob)) {
        continue;
      }

      if (completedJob.failed > 0) {
        const firstError = completedJob.errors[0]?.error;
        onToast(
          firstError
            ? `eBay upload finished with ${completedJob.failed} failure(s): ${firstError}`
            : `eBay upload finished with ${completedJob.failed} failure(s).`,
          "error",
        );
      } else {
        onToast(
          `Successfully uploaded ${completedJob.succeeded} listing(s) to eBay.`,
          "success",
        );
      }
    }

    previousActiveUploadJobIds.current = currentActiveIds;
  }, [activeUploadJobs, onToast, uploadJobs]);

  useEffect(() => {
    if (!autoExpandProductId) {
      return;
    }

    if (products.some((product) => product.id === autoExpandProductId)) {
      setExpandedProductId(autoExpandProductId);
      if (isProductsView && !hasCurrentProductDetails(autoExpandProductId)) {
        void loadProductDetails(autoExpandProductId);
      }
    }
  }, [
    autoExpandProductId,
    hasCurrentProductDetails,
    isProductsView,
    loadProductDetails,
    products,
  ]);

  useEffect(() => {
    if (
      isProductsView &&
      expandedProductId &&
      !hasCurrentProductDetails(expandedProductId)
    ) {
      void loadProductDetails(expandedProductId);
    }
  }, [
    expandedProductId,
    hasCurrentProductDetails,
    isProductsView,
    loadProductDetails,
  ]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!draftActionMenuProductId) return;
    const openProductId = draftActionMenuProductId;

    function closeDraftActionMenu(restoreFocus = false) {
      setDraftActionMenuProductId(null);
      if (restoreFocus) {
        window.requestAnimationFrame(() =>
          draftActionMenuTriggerRefs.current.get(openProductId)?.focus(),
        );
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target?.closest("[data-draft-action-menu]")) {
        closeDraftActionMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDraftActionMenu(true);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [draftActionMenuProductId]);

  function getStatusBadgeClasses(status: string) {
    if (status === "FAILED" && isDraftsView) {
      return "bg-red-100 text-red-800 ring-1 ring-inset ring-red-200";
    }

    if (status === "IMPORTED") {
      return "bg-green-100 text-green-700";
    }

    if (status === "FAILED") {
      return "bg-red-100 text-red-700";
    }

    if (status === "ON_HOLD") {
      return "bg-amber-100 text-amber-700";
    }

    return "bg-gray-100 text-gray-600";
  }

  function toggleExpand(productId: string) {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
      return;
    }

    setExpandedProductId(productId);
    if (isProductsView && !hasCurrentProductDetails(productId)) {
      void loadProductDetails(productId);
    }
  }

  function getFocusedProductUrl(productId: string) {
    return `/products?productId=${encodeURIComponent(productId)}`;
  }

  function shouldIgnoreContextMenu(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest("a,button,input,select,textarea,[role='button']"))
    );
  }

  function handleRowContextMenu(
    event: MouseEvent<HTMLTableRowElement>,
    product: SerializedProductRow
  ) {
    if (!isProductsView || shouldIgnoreContextMenu(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 224;
    const menuHeight = 170;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      product,
      x: Math.max(8, x),
      y: Math.max(8, y),
    });
  }

  function openContextProductInNewTab() {
    if (!contextMenu) {
      return;
    }

    const opened = window.open(
      getFocusedProductUrl(contextMenu.product.id),
      "_blank",
      "noopener,noreferrer"
    );

    if (opened) {
      opened.opener = null;
    }

    setContextMenu(null);
  }

  async function copyContextProductLink() {
    if (!contextMenu) {
      return;
    }

    const url = `${window.location.origin}${getFocusedProductUrl(contextMenu.product.id)}`;

    try {
      await navigator.clipboard.writeText(url);
      onToast("Product link copied.", "success");
    } catch {
      onToast("Could not copy product link.", "error");
    } finally {
      setContextMenu(null);
    }
  }

  async function handleImport(productId: string) {
    setLoadingId(productId);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, background: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        missingItemSpecifics?: string[];
        job?: UploadJob;
      };

      if (res.ok) {
        if (data.job) {
          setUploadJobs((current) => [
            data.job as UploadJob,
            ...current.filter((job) => job.id !== data.job?.id),
          ]);
        }
        onToast(data.message || "Upload queued. Track it in Action Center.", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== productId));
        router.refresh();
      } else {
        if (hasMissingItemSpecifics(data)) {
          setExpandedProductId(productId);
        }
        onToast(data.error || "Upload failed. Please try again.", "error");
        router.refresh();
      }
    } catch {
      onToast("Network error. Please check your connection.", "error");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(productId: string) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this product? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(productId);

    try {
      const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });

      if (res.ok) {
        onToast("Product deleted", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== productId));
        router.refresh();
      } else {
        onToast("Failed to delete product.", "error");
      }
    } catch {
      onToast("Failed to delete product.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  function openRemovalDialog(product: SerializedProductRow) {
    setContextMenu(null);
    setRemovalProduct(product);
  }

  async function handleRemoveFromListflow(productId: string) {
    setDeletingId(productId);

    try {
      const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.ok) {
        onToast("Removed from ListFlow. eBay listing was not changed.", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== productId));
        setExpandedProductId((current) => (current === productId ? null : current));
        setRemovalProduct(null);
        router.refresh();
      } else {
        onToast(data.error || "Failed to remove product from ListFlow.", "error");
      }
    } catch {
      onToast("Network error while removing product from ListFlow.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleEndListing(productId: string) {
    setEndingId(productId);

    try {
      const res = await fetch(`/api/products/${productId}/end`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        onToast("Listing ended on eBay and removed from ListFlow", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== productId));
        setExpandedProductId((current) => (current === productId ? null : current));
        setRemovalProduct(null);
        router.refresh();
      } else {
        onToast(data.error || "Failed to end listing.", "error");
      }
    } catch {
      onToast("Network error while ending listing.", "error");
    } finally {
      setEndingId(null);
    }
  }

  function openInternalNote(product: SerializedProductRow) {
    setNotingProduct(product);
    setNoteDraft(product.internalNote ?? "");
  }

  async function handleSaveInternalNote() {
    if (!notingProduct) {
      return;
    }

    setSavingNoteId(notingProduct.id);

    try {
      const res = await fetch(`/api/products/${notingProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNote: noteDraft }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        onToast(data.error || "Failed to save internal note.", "error");
        return;
      }

      onToast(
        noteDraft.trim() ? "Internal note saved" : "Internal note cleared",
        "success"
      );
      setNotingProduct(null);
      setNoteDraft("");
      router.refresh();
    } catch {
      onToast("Network error while saving internal note.", "error");
    } finally {
      setSavingNoteId(null);
    }
  }

  const selectableProducts = useMemo(
    () =>
      isDraftsView
        ? products.filter((product) => product.status !== "IMPORTED")
        : products.filter(
            (product) =>
              product.status === "IMPORTED" || product.status === "ON_HOLD"
          ),
    [isDraftsView, products],
  );
  const pageSelectableIds = useMemo(
    () => selectableProducts.map((product) => product.id),
    [selectableProducts],
  );
  const pageSelectableIdSet = useMemo(
    () => new Set(pageSelectableIds),
    [pageSelectableIds],
  );
  const selectionProducts = useMemo<SelectionProduct[]>(
    () =>
      isProductsView && allSelectionProducts
        ? allSelectionProducts
        : products,
    [allSelectionProducts, isProductsView, products],
  );
  const allMatchingIds = useMemo(
    () =>
      isProductsView && allSelectionProducts
        ? allSelectionProducts.map((product) => product.id)
        : pageSelectableIds,
    [allSelectionProducts, isProductsView, pageSelectableIds],
  );
  const allPageSelected = hasEverySelected(selectedIds, pageSelectableIds);
  const somePageSelected =
    pageSelectableIds.some((id) => selectedIds.includes(id)) && !allPageSelected;
  const allMatchingSelected =
    isProductsView &&
    allSelectionProducts !== null &&
    hasEverySelected(selectedIds, allMatchingIds);

  useEffect(() => {
    if (isProductsView) {
      return;
    }

    const selectableIdSet = new Set(pageSelectableIds);
    setSelectedIds((currentIds) => {
      const nextIds = currentIds.filter((id) => selectableIdSet.has(id));
      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });
  }, [isProductsView, pageSelectableIds]);

  useEffect(() => {
    if (!isProductsView) {
      return;
    }

    if (previousSelectionScopeKey.current !== selectionScopeKey) {
      previousSelectionScopeKey.current = selectionScopeKey;
      setSelectedIds([]);
    }
  }, [isProductsView, selectionScopeKey]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = somePageSelected;
    }
  }, [somePageSelected]);

  function toggleSelect(productId: string) {
    if (!pageSelectableIdSet.has(productId)) {
      return;
    }

    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  }

  function toggleSelectAll() {
    setSelectedIds((current) =>
      setPageSelection(current, pageSelectableIds, !allPageSelected),
    );
  }

  async function selectAllListings() {
    if (!isProductsView || !onSelectAllListings) {
      return;
    }

    setIsSelectingAllListings(true);

    try {
      const completeSelection =
        allSelectionProducts ?? (await onSelectAllListings());
      setSelectedIds(completeSelection.map((product) => product.id));
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "Unable to select all listings.",
        "error",
      );
    } finally {
      setIsSelectingAllListings(false);
    }
  }

  const selectedPendingCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return selectionProducts.filter(
      (product) =>
        selectedIds.includes(product.id) &&
        hasPendingPriceChange(product)
    ).length;
  }, [isProductsView, selectedIds, selectionProducts]);

  const selectedOnHoldCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return selectionProducts.filter(
      (product) =>
        selectedIds.includes(product.id) && product.status === "ON_HOLD"
    ).length;
  }, [isProductsView, selectedIds, selectionProducts]);

  const selectedImportedCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return selectionProducts.filter(
      (product) =>
        selectedIds.includes(product.id) && product.status === "IMPORTED"
    ).length;
  }, [isProductsView, selectedIds, selectionProducts]);

  const selectedListedCount = selectedImportedCount + selectedOnHoldCount;

  const selectedPriceCheckSummary = useMemo(
    () =>
      isProductsView
        ? getSelectedPriceCheckSummary(selectionProducts, selectedIds)
        : null,
    [isProductsView, selectedIds, selectionProducts]
  );

  async function handleBulkApplySelected() {
    const idsWithPending = selectionProducts
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          hasPendingPriceChange(product)
      )
      .map((product) => product.id);

    if (idsWithPending.length === 0) {
      onToast("No selected products have pending price changes.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Apply pending price changes for ${idsWithPending.length} selected product(s) and revise their eBay listings? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkApplying(true);

    try {
      const res = await fetch("/api/price-check/bulk-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: idsWithPending }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        total?: number;
        applied?: number;
        failed?: number;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk apply failed.", "error");
        router.refresh();
        return;
      }

      const failureCount = data.failed ?? 0;
      const appliedCount = data.applied ?? 0;
      const totalCount = data.total ?? 0;

      onToast(
        failureCount > 0
          ? `Applied ${appliedCount}/${totalCount} price change(s). ${failureCount} failed.`
          : `Applied all ${appliedCount} price change(s) successfully.`,
        failureCount > 0 ? "error" : "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while applying price changes.", "error");
    } finally {
      setIsBulkApplying(false);
    }
  }

  async function handleBulkDismissSelected() {
    const idsWithPending = selectionProducts
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          hasPendingPriceChange(product)
      )
      .map((product) => product.id);

    if (idsWithPending.length === 0) {
      onToast("No selected products have pending price changes.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Dismiss pending price changes for ${idsWithPending.length} selected product(s) without updating eBay?`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkDismissing(true);

    try {
      const res = await fetch("/api/price-check/bulk-dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: idsWithPending }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        dismissed?: number;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk dismiss failed.", "error");
        router.refresh();
        return;
      }

      onToast(
        `Dismissed ${data.dismissed ?? 0} pending price change(s).`,
        "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while dismissing price changes.", "error");
    } finally {
      setIsBulkDismissing(false);
    }
  }

  async function handleBulkPriceCheck() {
    const idsToCheck =
      selectedPriceCheckSummary?.eligibleIds ??
      selectedIds.filter((id) => {
        const p = selectionProducts.find((product) => product.id === id);
        return p && canCheckProductPrice(p);
      });

    if (idsToCheck.length === 0) {
      onToast(
        selectedPriceCheckSummary?.message ??
          "Select at least one tracked product first.",
        "error"
      );
      return;
    }

    setIsBulkPriceChecking(true);

    try {
      if (onPriceCheckSelected) {
        await onPriceCheckSelected(selectedIds);
        setSelectedIds([]);
        return;
      }

      const res = await fetch("/api/price-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: idsToCheck }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checked?: number;
        changed?: number;
        pendingReview?: number;
        failed?: number;
        skipped?: number;
        reason?: string;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Failed to check selected prices.", "error");
        return;
      }

      setSelectedIds([]);
      router.refresh();

      onToast(
        data.reason
          ? data.reason
          : `Checked ${data.checked ?? 0} selected product(s). ${data.pendingReview ?? 0} pending review, ${data.failed ?? 0} failed, ${data.skipped ?? 0} unchanged.`,
        data.failed && data.failed > 0 ? "error" : "success"
      );
    } catch {
      onToast("Network error while checking selected prices.", "error");
    } finally {
      setIsBulkPriceChecking(false);
    }
  }

  async function handleBulkResumeSelected() {
    const onHoldIds = selectionProducts
      .filter((product) => selectedIds.includes(product.id) && product.status === "ON_HOLD")
      .map((product) => product.id);

    if (onHoldIds.length === 0) {
      onToast("No selected products are on hold.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Resume listing(s) on eBay for ${onHoldIds.length} selected product(s)? This will restore their original quantities.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkResuming(true);

    try {
      const res = await fetch("/api/products/bulk-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: onHoldIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        total?: number;
        resumed?: number;
        failed?: number;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk resume failed.", "error");
        router.refresh();
        return;
      }

      const failureCount = data.failed ?? 0;
      const resumedCount = data.resumed ?? 0;

      if (data.message) {
        onToast(data.message, "success");
        setSelectedIds([]);
        router.refresh();
        return;
      }

      onToast(
        failureCount > 0
          ? `Resumed ${resumedCount} listing(s). ${failureCount} failed.`
          : `Successfully resumed all ${resumedCount} listing(s).`,
        failureCount > 0 ? "error" : "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while resuming listings.", "error");
    } finally {
      setIsBulkResuming(false);
    }
  }

  async function handleBulkHoldSelected() {
    const importedIds = selectionProducts
      .filter(
        (product) =>
          selectedIds.includes(product.id) && product.status === "IMPORTED"
      )
      .map((product) => product.id);

    if (importedIds.length === 0) {
      onToast("No selected products are imported.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Set eBay listing quantity to 0 for ${importedIds.length} selected product(s)? This will hide them from eBay search.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkHolding(true);

    try {
      const res = await fetch("/api/products/bulk-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: importedIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        total?: number;
        held?: number;
        failed?: number;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk hold failed.", "error");
        router.refresh();
        return;
      }

      const failureCount = data.failed ?? 0;
      const heldCount = data.held ?? 0;

      if (data.message) {
        onToast(data.message, "success");
        setSelectedIds([]);
        router.refresh();
        return;
      }

      onToast(
        failureCount > 0
          ? `Put ${heldCount} product(s) on hold. ${failureCount} failed.`
          : `Successfully put ${heldCount} product(s) on hold.`,
        failureCount > 0 ? "error" : "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while putting products on hold.", "error");
    } finally {
      setIsBulkHolding(false);
    }
  }

  async function handleBulkRemoveFromListflowSelected() {
    const listedIds = selectionProducts
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          (product.status === "IMPORTED" || product.status === "ON_HOLD")
      )
      .map((product) => product.id);

    if (listedIds.length === 0) {
      onToast("No selected listed products to remove.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Remove ${listedIds.length} product(s) from ListFlow only?\n\nLive eBay listings will remain active and unchanged.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkRemovingListflow(true);

    try {
      const res = await fetch("/api/products/bulk-remove-listflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: listedIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        deletedCount?: number;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Failed to remove products from ListFlow.", "error");
        router.refresh();
        return;
      }

      onToast(
        `Removed ${data.deletedCount ?? listedIds.length} product(s) from ListFlow. eBay was not changed.`,
        "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while removing products from ListFlow.", "error");
    } finally {
      setIsBulkRemovingListflow(false);
    }
  }

  async function handleBulkEndAndRemoveSelected() {
    const listedIds = selectionProducts
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          (product.status === "IMPORTED" || product.status === "ON_HOLD")
      )
      .map((product) => product.id);

    if (listedIds.length === 0) {
      onToast("No selected listed products to end.", "error");
      return;
    }

    const confirmed = window.confirm(
      `End ${listedIds.length} eBay listing(s) and remove them from ListFlow?\n\nThis will change eBay. It cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkEnding(true);

    try {
      const res = await fetch("/api/products/bulk-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: listedIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        total?: number;
        ended?: number;
        failed?: number;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Failed to queue eBay removal.", "error");
        router.refresh();
        return;
      }

      onToast(
        data.message ||
          `Queued ${data.total ?? listedIds.length} listing(s) to end on eBay and remove from ListFlow.`,
        "success"
      );
      setSelectedIds([]);
      router.refresh();
    } catch {
      onToast("Network error while queueing eBay removal.", "error");
    } finally {
      setIsBulkEnding(false);
    }
  }

  async function handlePriceReview(
    priceHistoryId: string,
    action: "apply" | "dismiss"
  ) {
    if (action === "apply") {
      const confirmed = window.confirm(
        "Apply this price change to local variants and revise the eBay listing?"
      );

      if (!confirmed) {
        return;
      }
    }

    setReviewingPriceHistoryId(priceHistoryId);

    try {
      const res = await fetch(`/api/price-check/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceHistoryId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        applied?: number;
        dismissed?: number;
      };

      if (!res.ok) {
        onToast(data.error || "Failed to review price change.", "error");
        router.refresh();
        return;
      }

      onToast(
        action === "apply"
          ? `Applied ${data.applied ?? 0} price change(s).`
          : `Dismissed ${data.dismissed ?? 0} price change(s).`,
        "success"
      );
      router.refresh();
    } catch {
      onToast("Network error while reviewing price change.", "error");
    } finally {
      setReviewingPriceHistoryId(null);
    }
  }

  async function handleBulkImport() {
    const selected = products.filter((product) => selectedIds.includes(product.id));

    for (const product of selected) {
      const categoryId = (product.category || "").trim();

      if (!categoryId || !/^\d+$/.test(categoryId)) {
        onToast(
          "Some products are missing required fields (category ID or policies). Please edit them before bulk importing.",
          "error"
        );
        return;
      }

      if (
        !product.shippingPolicyId ||
        !product.returnPolicyId ||
        !product.paymentPolicyId
      ) {
        onToast(
          "Some products are missing required fields (category ID or policies). Please edit them before bulk importing.",
          "error"
        );
        return;
      }
    }

    setBulkImporting(true);

    let skippedAmazon = 0;
    const uploadProductIds: string[] = [];

    for (const product of selected) {
      const plainText = product.description.replace(/<[^>]*>/g, "");

      if (/amazon/i.test(plainText)) {
        skippedAmazon += 1;
        continue;
      }

      uploadProductIds.push(product.id);
    }

    if (uploadProductIds.length === 0) {
      setBulkImporting(false);
      onToast(
        skippedAmazon > 0
          ? `${skippedAmazon} product(s) skipped - description contains 'Amazon'. Edit and retry.`
          : "No selected drafts are ready to upload.",
        "error"
      );
      return;
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: uploadProductIds, background: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        job?: UploadJob;
      };

      if (!res.ok) {
        onToast(data.error || "Failed to queue selected drafts.", "error");
        router.refresh();
        return;
      }

      if (data.job) {
        setUploadJobs((current) => [
          data.job as UploadJob,
          ...current.filter((job) => job.id !== data.job?.id),
        ]);
      }
      setSelectedIds([]);
      onToast(
        data.message ||
          `Queued ${data.job?.total ?? uploadProductIds.length} listing(s) to upload.`,
        "success"
      );
      router.refresh();
    } catch {
      onToast("Network error while queueing selected drafts.", "error");
    } finally {
      setBulkImporting(false);
    }

    if (skippedAmazon > 0) {
      onToast(
        `${skippedAmazon} product(s) skipped - description contains 'Amazon'. Edit and retry.`,
        "error"
      );
    }
  }

  async function handleBulkDelete() {
    const idsToDelete = selectedIds;

    if (idsToDelete.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${idsToDelete.length} selected draft(s)? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkDeleting(true);

    try {
      const res = await fetch("/api/products/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: idsToDelete }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const deletedCount =
          typeof data.deletedCount === "number"
            ? data.deletedCount
            : idsToDelete.length;

        setSelectedIds([]);
        onToast(
          `${deletedCount} selected draft(s) deleted`,
          "success"
        );
        router.refresh();
      } else {
        onToast(data.error || "Failed to delete selected drafts.", "error");
      }
    } catch {
      onToast("Network error while deleting selected drafts.", "error");
    } finally {
      setIsBulkDeleting(false);
    }
  }

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-14 text-center shadow-sm">
        <svg
          className="mx-auto mb-4 h-12 w-12 text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <p className="text-sm font-medium text-gray-600">
          {isDraftsView
            ? "No products to upload yet. Click 'Normal Upload' or 'Advanced Upload' to get started."
            : "No active listings yet. Import a draft to publish it on eBay."}
        </p>
      </div>
    );
  }

  const columnCount = isProductsView ? 12 : 8;

  return (
    <>
      {isDraftsView && activeUploadJobs.length > 0 && (
        <div className="mb-4 space-y-3" aria-live="polite">
          {activeUploadJobs.map((job) => {
            const indeterminate = job.total === 1 && job.processed === 0;
            const statusLabel =
              job.status === "QUEUED" ? "Queued for eBay" : "Uploading to eBay";
            const queueDetail =
              job.status === "QUEUED" && job.queuePosition
                ? `Queue position ${job.queuePosition}. `
                : "";

            return (
              <div
                key={job.id}
                className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 shadow-sm"
              >
                <ActionProgressBar
                  label={statusLabel}
                  percent={getUploadJobPercent(job)}
                  indeterminate={indeterminate || job.status === "QUEUED"}
                  tone="blue"
                  detail={`${queueDetail}${job.processed}/${job.total} processed, ${job.succeeded} succeeded, ${job.failed} failed.`}
                />
              </div>
            );
          })}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-gray-500">
            {selectedIds.length} selected
          </span>
          {isProductsView && totalListingCount > pageSelectableIds.length && (
            allMatchingSelected ? (
              <span className="font-medium text-blue-700">
                All {allMatchingIds.length} selected
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void selectAllListings()}
                disabled={isSelectingAllListings || isSelectAllListingsLoading}
                className="font-medium text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
              >
                {isSelectingAllListings || isSelectAllListingsLoading
                  ? "Selecting all…"
                  : `Select all ${totalListingCount} listings`}
              </button>
            )
          )}
        </div>
      )}

      <div
        className={
          isDraftsView
            ? "max-w-full xl:overflow-clip xl:rounded-2xl xl:border xl:border-gray-200 xl:bg-white xl:shadow-sm"
            : "max-w-full overflow-clip rounded-lg border border-gray-200 bg-white"
        }
      >
        <div
          ref={tableScrollContainerRef}
          onMouseDown={handleTableMouseDown}
          onMouseMove={handleTableMouseMove}
          onMouseUp={handleTableMouseUpOrLeave}
          onMouseLeave={handleTableMouseUpOrLeave}
          className={
            isDraftsView
              ? "relative max-w-full"
              : `relative max-w-full overflow-x-auto listflow-table-drag-container ${
                  isTableDragging ? "listflow-table-dragging" : ""
                }`
          }
        >
          <table
            className={
              isProductsView
                ? `w-full min-w-[1496px] table-fixed ${
                    isSortPending ? "listflow-table-sorting" : ""
                  }`
                : "block w-full xl:table"
            }
          >
          {isProductsView && (
            <colgroup>
              <col className="w-12" />
              <col className="w-7" />
              <col className="w-[58px]" />
              <col className="w-[280px]" />
              <col className="w-[150px]" />
              <col className="w-[124px]" />
              <col className="w-[132px]" />
              <col className="w-[96px]" />
              <col className="w-[84px]" />
              <col className="w-[94px]" />
              <col className="w-[230px]" />
              <col className="w-12" />
              <col className="w-[128px]" />
            </colgroup>
          )}
          <thead className={isDraftsView ? "hidden xl:table-header-group" : undefined}>
            <tr className="border-b bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {hasSelectionColumn && (
                <th className="px-3 py-3 text-left w-10">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAll}
                    disabled={pageSelectableIds.length === 0}
                    aria-label="Select all listings on this page"
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                </th>
              )}
              <th className="px-2 py-3 text-left w-10" />
              <th className="px-3 py-3 text-left w-14">Image</th>
              <th className="px-3 py-3 text-left">Title</th>
              {isProductsView && (
                <>
                  <ProductSortHeader
                    label="Price"
                    field="price"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    isSortPending={isSortPending}
                    onSortChange={onSortChange}
                  />
                  <ProductSortHeader
                    label="Profit"
                    field="profit"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    isSortPending={isSortPending}
                    onSortChange={onSortChange}
                  />
                  <th className="px-3 py-3 text-left">Item ID</th>
                </>
              )}
              {!isProductsView && (
                <th className="px-3 py-3 text-left">Store</th>
              )}
              {isProductsView ? (
                <>
                  <ProductSortHeader
                    label="Uploaded"
                    field="uploaded"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    isSortPending={isSortPending}
                    onSortChange={onSortChange}
                  />
                  <ProductSortHeader
                    label="Sold"
                    field="sold"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    isSortPending={isSortPending}
                    onSortChange={onSortChange}
                  />
                </>
              ) : (
                <th className="px-3 py-3 text-left">Created by</th>
              )}
              <th className="px-3 py-3 text-left">Status</th>
              {isProductsView && (
                <>
                  <th className="px-3 py-3 text-left">Price Tracking</th>
                  <th className="px-2 py-3 text-left">Note</th>
                </>
              )}
              <th
                className={
                  isProductsView
                    ? "sticky right-0 z-20 border-l border-gray-200 bg-gray-50 px-3 py-3 text-left shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.7)]"
                    : "px-3 py-3 text-left"
                }
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className={isDraftsView ? "block space-y-3 xl:table-row-group xl:space-y-0" : undefined}>
            {products.map((product) => {
              const isExpanded = expandedProductId === product.id;
              const expandedProduct = isProductsView
                ? productDetails[product.id] ?? null
                : product;
              const isLoadingProductDetails =
                loadingProductDetailIds.includes(product.id);
              const productDetailError = productDetailErrors[product.id] ?? null;
              const isSelected = selectedIds.includes(product.id);
              const isSelectable = pageSelectableIdSet.has(product.id);
              const uploadJob = uploadJobByProductId.get(product.id) ?? null;
              const isUploadQueued = Boolean(uploadJob);
              const isFailedDraft =
                isDraftsView && product.status === "FAILED";
              const trackingState = isProductsView
                ? getPriceTrackingState(product)
                : null;
              const promotedAdState = isProductsView
                ? getPromotedAdState(product)
                : null;
              const rowToneClass = isExpanded
                ? "bg-orange-50"
                : isFailedDraft
                  ? "bg-red-50 hover:bg-red-100"
                  : "bg-white hover:bg-gray-50";
              const stickyActionToneClass = isExpanded
                ? "bg-orange-50"
                : isFailedDraft
                  ? "bg-red-50 group-hover:bg-red-100"
                  : "bg-white group-hover:bg-gray-50";

              return (
                <Fragment key={product.id}>
                  <tr
                    className={
                      isDraftsView
                        ? `group grid cursor-pointer grid-cols-[auto_4rem_minmax(0,1fr)] gap-x-3 rounded-2xl border border-gray-200 p-4 shadow-sm transition-colors xl:table-row xl:rounded-none xl:border-0 xl:border-b xl:p-0 xl:shadow-none listflow-row-animate ${rowToneClass}`
                        : `group cursor-pointer border-b transition-colors listflow-row-animate ${rowToneClass}`
                    }
                    onClick={() => toggleExpand(product.id)}
                    onKeyDown={(event) => {
                      if (
                        isDraftsView &&
                        event.currentTarget === event.target &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        toggleExpand(product.id);
                      }
                    }}
                    tabIndex={isDraftsView ? 0 : undefined}
                    aria-expanded={isDraftsView ? isExpanded : undefined}
                    aria-controls={isDraftsView ? `draft-editor-${product.id}` : undefined}
                    onContextMenu={(event) =>
                      handleRowContextMenu(event, product)
                    }
                  >
                    {hasSelectionColumn && (
                      <td
                        className={
                          isDraftsView
                            ? "col-start-1 row-start-1 p-0 xl:table-cell xl:px-3 xl:py-4"
                            : "px-3 py-3"
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isSelectable}
                          onChange={() => toggleSelect(product.id)}
                          title={
                            isProductsView && !isSelectable
                              ? "Add an ASIN and at least one variant to price check this product."
                              : undefined
                          }
                          aria-label={`Select ${product.title}`}
                          className="h-5 w-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500 xl:h-4 xl:w-4"
                        />
                      </td>
                    )}

                    <td className={isDraftsView ? "hidden px-2 py-3 xl:table-cell" : "px-2 py-3"}>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>

                    <td
                      className={
                        isDraftsView
                          ? "col-start-2 row-start-1 row-span-2 p-0 xl:table-cell xl:px-3 xl:py-4"
                          : "px-3 py-3"
                      }
                    >
                      {product.images && product.images.length > 0 ? (
                        <img
                          src={product.images[0]}
                          alt={product.title}
                          className="h-16 w-16 rounded-xl object-cover ring-1 ring-gray-200 xl:h-12 xl:w-12 xl:rounded-lg"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gray-100 ring-1 ring-gray-200 xl:h-12 xl:w-12 xl:rounded-lg">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    <td
                      className={
                        isDraftsView
                          ? "col-start-3 row-start-1 min-w-0 p-0 xl:table-cell xl:px-3 xl:py-4"
                          : "px-3 py-3"
                      }
                    >
                      <div className={isProductsView ? "max-w-[15rem]" : "min-w-0 xl:max-w-xs"}>
                        <span
                          className="block text-sm font-semibold leading-5 text-gray-900 xl:truncate"
                          title={product.title}
                        >
                          {product.title}
                        </span>
                        {isFailedDraft && product.errorMessage && (
                          <span
                            className="mt-1 block text-xs leading-5 text-red-600 xl:truncate"
                            title={product.errorMessage}
                          >
                            {product.errorMessage}
                          </span>
                        )}
                        {isDraftsView && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 xl:hidden">
                            <span
                              className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${getStoreBadgeClass(product.store.id, product.store.name)}`}
                            >
                              {product.store.name}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClasses(product.status)}`}
                              title={
                                product.status === "ON_HOLD"
                                  ? getProductHoldReason(product) ?? undefined
                                  : undefined
                              }
                            >
                              {statusBadgeLabels[product.status] || product.status}
                            </span>
                            {product.status === "ON_HOLD" && (
                              <span
                                className="basis-full text-xs text-amber-700 font-medium"
                                title={getProductHoldReason(product) ?? undefined}
                              >
                                {getProductHoldReason(product)}
                              </span>
                            )}
                            <span className="basis-full text-xs text-gray-500 sm:basis-auto">
                              Created by {product.createdBy.name}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    {isProductsView && (
                      <>
                        <td className="px-3 py-3">
                          <PriceCell product={product} />
                        </td>

                        <td className="px-3 py-3">
                          <ProfitCell product={product} />
                        </td>

                        <td className="px-3 py-3">
                          <ItemIdCell product={product} />
                        </td>
                      </>
                    )}

                    {!isProductsView && (
                      <td className="hidden px-3 py-4 xl:table-cell">
                        <span
                          className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            getStoreBadgeClass(product.store.id, product.store.name)
                          }`}
                        >
                          {product.store.name}
                        </span>
                      </td>
                    )}

                    <td className={isDraftsView ? "hidden px-3 py-4 xl:table-cell" : "px-3 py-3"}>
                      <span className="whitespace-nowrap text-sm text-gray-500">
                        {isProductsView
                          ? formatDate(product.uploadedAt) ?? "-"
                          : product.createdBy.name}
                      </span>
                    </td>

                    {isProductsView && (
                      <td className="px-3 py-3">
                        {product.quantitySold > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20"
                            title={`${product.quantitySold} item${product.quantitySold === 1 ? "" : "s"} sold on eBay`}
                          >
                            <svg
                              className="h-3 w-3 text-emerald-600"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.2}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span>{product.quantitySold}</span>
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-400">
                            0
                          </span>
                        )}
                      </td>
                    )}

                    <td className={isDraftsView ? "hidden px-3 py-4 xl:table-cell" : "px-3 py-3"}>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(product.status)}`}
                        title={
                          product.status === "ON_HOLD"
                            ? getProductHoldReason(product) ?? undefined
                            : undefined
                        }
                      >
                        {statusBadgeLabels[product.status] || product.status}
                      </span>
                      {product.status === "ON_HOLD" && (
                        <span
                          className="mt-1 block max-w-[12rem] truncate text-xs text-amber-700 font-normal"
                          title={getProductHoldReason(product) ?? undefined}
                        >
                          {getProductHoldReason(product)}
                        </span>
                      )}
                    </td>

                    {isProductsView && trackingState && promotedAdState && (
                      <td className="px-3 py-3">
                        <div className="max-w-[13rem]">
                          <span
                            className={`mb-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${promotedAdState.badgeClass}`}
                            title={promotedAdState.detail}
                          >
                            {promotedAdState.label}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${trackingState.badgeClass}`}
                          >
                            {trackingState.label}
                          </span>
                          <span
                            className="mt-1 block truncate text-xs text-gray-500"
                            title={trackingState.detail}
                          >
                            {trackingState.detail}
                          </span>
                          {trackingState.priceHistoryId && (
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handlePriceReview(
                                    trackingState.priceHistoryId,
                                    "apply"
                                  );
                                }}
                                disabled={
                                  reviewingPriceHistoryId ===
                                  trackingState.priceHistoryId
                                }
                                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handlePriceReview(
                                    trackingState.priceHistoryId,
                                    "dismiss"
                                  );
                                }}
                                disabled={
                                  reviewingPriceHistoryId ===
                                  trackingState.priceHistoryId
                                }
                                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    )}

                    {isProductsView && (
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openInternalNote(product)}
                          title={
                            product.internalNote
                              ? `Edit internal note: ${product.internalNote}`
                              : "Add an internal note"
                          }
                          aria-label={
                            product.internalNote
                              ? "Edit internal note"
                              : "Add an internal note"
                          }
                          className={`inline-flex h-8 w-8 items-center justify-center rounded transition-colors ${
                            product.internalNote
                              ? "text-orange-600 hover:bg-orange-50"
                              : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          }`}
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
                              d="M7.5 4.5h7.25a2.75 2.75 0 012.75 2.75v5.5a2.75 2.75 0 01-2.75 2.75H11L6.5 20v-3.75a1.75 1.75 0 01-1.5-1.73V7.25A2.75 2.75 0 017.5 4.5z"
                            />
                          </svg>
                        </button>
                      </td>
                    )}

                    <td
                      className={
                        isProductsView
                          ? `sticky right-0 z-10 border-l border-gray-100 px-3 py-3 shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.7)] ${stickyActionToneClass}`
                          : "col-span-3 mt-4 border-t border-gray-200 p-0 pt-4 xl:table-cell xl:mt-0 xl:border-t-0 xl:px-3 xl:py-4"
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isDraftsView ? (
                        <div className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 xl:justify-start">
                          <div className="min-w-0 flex-1 xl:flex-none">
                            {loadingId === product.id ? (
                              <Button
                                variant="primary"
                                size="md"
                                pending
                                pendingLabel="Queueing…"
                                fullWidth
                                className="border-gray-500 bg-gray-500 xl:w-auto"
                              >
                                Queue
                              </Button>
                            ) : isUploadQueued && uploadJob && product.status !== "IMPORTED" ? (
                              <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2 xl:w-44">
                                <ActionProgressBar
                                  label={
                                    uploadJob.completedProductIds.includes(product.id)
                                      ? "Processed"
                                      : uploadJob.status === "QUEUED"
                                        ? "Queued"
                                        : "Uploading"
                                  }
                                  percent={uploadJob.completedProductIds.includes(product.id) ? 100 : 0}
                                  indeterminate={!uploadJob.completedProductIds.includes(product.id)}
                                  tone={
                                    uploadJob.errors.some((error) => error.productId === product.id)
                                      ? "red"
                                      : "blue"
                                  }
                                  compact
                                />
                              </div>
                            ) : product.status === "FAILED" ? (
                              <Button
                                onClick={() => handleImport(product.id)}
                                variant="danger"
                                size="md"
                                fullWidth
                                className="xl:w-auto"
                              >
                                Retry upload
                              </Button>
                            ) : product.status === "DRAFT" ? (
                              <Button
                                onClick={() => handleImport(product.id)}
                                variant="primary"
                                size="md"
                                fullWidth
                                className="border-orange-500 bg-orange-500 hover:border-orange-600 hover:bg-orange-600 xl:w-auto"
                              >
                                Import to eBay
                              </Button>
                            ) : (
                              <span className="inline-flex min-h-10 items-center rounded-lg bg-green-100 px-3 text-sm font-semibold text-green-700">
                                Imported
                              </span>
                            )}
                          </div>

                          <div className="hidden min-h-11 items-stretch gap-2 xl:flex">
                            {product.status !== "IMPORTED" && (
                              <Button
                                onClick={() => handleDelete(product.id)}
                                disabled={deletingId === product.id}
                                pending={deletingId === product.id}
                                pendingLabel="Deletingâ€¦"
                                variant="danger"
                                size="md"
                                className="min-w-[6.5rem] whitespace-nowrap"
                                aria-label={`Delete ${product.title}`}
                                icon={
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                  </svg>
                                }
                              >
                                Delete
                              </Button>
                            )}
                            {product.ebayItemId && (
                              <a
                                href={`https://www.ebay.com.au/itm/${product.ebayItemId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                title="Go to eBay"
                                aria-label={`Open eBay item ${product.ebayItemId}`}
                              >
                                <PlatformIcon platform="ebay" />
                              </a>
                            )}
                          </div>

                          {(product.status !== "IMPORTED" || product.ebayItemId) && (
                            <div className="relative xl:hidden" data-draft-action-menu>
                              <Button
                                ref={(node) => {
                                  if (node) draftActionMenuTriggerRefs.current.set(product.id, node);
                                  else draftActionMenuTriggerRefs.current.delete(product.id);
                                }}
                                variant="secondary"
                                onClick={() =>
                                  setDraftActionMenuProductId((current) =>
                                    current === product.id ? null : product.id,
                                  )
                                }
                                aria-haspopup="menu"
                                aria-expanded={draftActionMenuProductId === product.id}
                                className="px-3"
                              >
                                More
                              </Button>
                              {draftActionMenuProductId === product.id && (
                                <div className="absolute bottom-full right-0 z-30 mb-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl" role="menu">
                                  {product.ebayItemId && (
                                    <a
                                      href={`https://www.ebay.com.au/itm/${product.ebayItemId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                                      role="menuitem"
                                    >
                                      <PlatformIcon platform="ebay" />
                                      <span>Open on eBay</span>
                                    </a>
                                  )}
                                  {product.status !== "IMPORTED" && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDraftActionMenuProductId(null);
                                        void handleDelete(product.id);
                                      }}
                                      disabled={deletingId === product.id}
                                      className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-quaternary hover:bg-quaternary-soft disabled:opacity-50"
                                      role="menuitem"
                                    >
                                      {deletingId === product.id ? "Deleting…" : "Delete draft"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {(product.status === "IMPORTED" || product.status === "ON_HOLD") && (
                            <button
                              onClick={() => openRemovalDialog(product)}
                              disabled={endingId === product.id || deletingId === product.id}
                              className="flex items-center gap-1 whitespace-nowrap rounded bg-quaternary px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-quaternary-hover disabled:opacity-40"
                              title="Choose how to remove this product"
                            >
                              {endingId === product.id || deletingId === product.id ? "Removing..." : "Remove"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr
                      className={
                        isDraftsView
                          ? "block overflow-clip rounded-2xl border border-orange-200 bg-gray-50 shadow-sm xl:table-row xl:rounded-none xl:border-0 xl:shadow-none"
                          : undefined
                      }
                    >
                      <td
                        colSpan={columnCount}
                        className={isDraftsView ? "block p-0 xl:table-cell" : "p-0"}
                      >
                        <div
                          id={isDraftsView ? `draft-editor-${product.id}` : undefined}
                          className={
                            isProductsView
                              ? "sticky left-0 w-full max-w-[calc(100vw-1.5rem)] md:max-w-[calc(100vw-5rem)] xl:max-w-none"
                              : undefined
                          }
                        >
                          {expandedProduct ? (
                            <InlineEditForm
                              product={expandedProduct as never}
                              onCollapse={() => setExpandedProductId(null)}
                              onImported={onDraftImported}
                            />
                          ) : productDetailError ? (
                            <div className="flex min-h-28 items-center justify-between gap-4 border-t border-red-100 bg-red-50 px-6 py-5">
                              <p className="text-sm text-red-700">
                                {productDetailError}
                              </p>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void loadProductDetails(product.id);
                                }}
                                className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <div
                              className="flex min-h-28 items-center justify-center border-t border-gray-100 bg-gray-50 px-6 py-5 text-sm text-gray-500"
                              aria-live="polite"
                            >
                              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
                              {isLoadingProductDetails
                                ? "Loading product details..."
                                : "Preparing product details..."}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="truncate border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-500"
            title={contextMenu.product.title}
          >
            {contextMenu.product.title}
          </div>
          <button
            type="button"
            onClick={openContextProductInNewTab}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
          >
            Open in new tab
          </button>
          <button
            type="button"
            onClick={() => void copyContextProductLink()}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
          >
            Copy product link
          </button>
          <button
            type="button"
            onClick={() => openRemovalDialog(contextMenu.product)}
            className="block w-full px-3 py-2 text-left text-sm font-medium text-quaternary transition-colors hover:bg-quaternary-soft"
          >
            Remove...
          </button>
        </div>
      )}

      {removalProduct && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4"
          onClick={() => {
            if (!deletingId && !endingId) {
              setRemovalProduct(null);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Remove product
              </h2>
              <p className="mt-1 truncate text-sm text-gray-500">
                {removalProduct.title}
              </p>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void handleRemoveFromListflow(removalProduct.id)}
                disabled={Boolean(deletingId || endingId)}
                className="w-full rounded-md border border-gray-300 px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="block text-sm font-semibold text-gray-900">
                  Remove from ListFlow only
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  Keeps the live eBay listing active and unchanged.
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleEndListing(removalProduct.id)}
                disabled={Boolean(deletingId || endingId)}
                className="w-full rounded-md border border-quaternary bg-quaternary-soft px-4 py-3 text-left transition-colors hover:border-quaternary-hover disabled:opacity-50"
              >
                <span className="block text-sm font-semibold text-quaternary-hover">
                  End on eBay and remove from ListFlow
                </span>
                <span className="mt-1 block text-xs text-quaternary">
                  Ends the eBay listing, then deletes the local product record.
                </span>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setRemovalProduct(null)}
                disabled={Boolean(deletingId || endingId)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {notingProduct && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4"
          onClick={() => {
            if (!savingNoteId) {
              setNotingProduct(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Internal note
              </h2>
              <p className="mt-1 truncate text-sm text-gray-500">
                {notingProduct.title}
              </p>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              placeholder="Add an internal note"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotingProduct(null)}
                disabled={Boolean(savingNoteId)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveInternalNote}
                disabled={Boolean(savingNoteId)}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {savingNoteId ? "Saving..." : "Save note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedIds.length > 0 && isDraftsView && (
        <div className="h-44 sm:h-28 xl:h-24" aria-hidden="true" />
      )}

      {selectedIds.length > 0 && (
        <div
          className={
            isDraftsView
              ? "fixed bottom-4 left-[17rem] right-4 z-30 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-2xl backdrop-blur md:left-[17.5rem] md:right-6 xl:flex-row xl:items-center xl:justify-between"
              : "fixed bottom-0 left-64 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-30 flex items-center justify-between"
          }
          aria-live="polite"
        >
          <div className="min-w-0">
            <div className="text-sm text-gray-500">
              {selectedIds.length} product(s) selected
            </div>
            {isProductsView &&
              selectedPriceCheckSummary &&
              selectedPriceCheckSummary.ineligibleCount > 0 && (
                <div
                  className="mt-1 max-w-2xl truncate text-xs text-amber-700"
                  title={selectedPriceCheckSummary.message}
                >
                  {selectedPriceCheckSummary.message}
                </div>
              )}
          </div>
          <div
            className={
              isDraftsView
                ? "grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:w-auto xl:flex-wrap xl:items-center xl:justify-end"
                : "flex flex-wrap items-center justify-end gap-3"
            }
          >
            {isDraftsView ? (
              <Button onClick={() => setSelectedIds([])} variant="secondary" fullWidth>
                Deselect
              </Button>
            ) : (
              <button
                onClick={() => setSelectedIds([])}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                Deselect All
              </button>
            )}
            {isDraftsView && (
              <>
                <Button
                  onClick={handleBulkImport}
                  disabled={bulkImporting || isBulkDeleting}
                  pending={bulkImporting}
                  pendingLabel="Queueing…"
                  variant="primary"
                  fullWidth
                  className="border-orange-500 bg-orange-500 hover:border-orange-600 hover:bg-orange-600"
                >
                  Queue Selected
                </Button>
                <Button
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting || bulkImporting}
                  pending={isBulkDeleting}
                  pendingLabel="Deleting…"
                  variant="danger"
                  fullWidth
                >
                  Delete Selected
                </Button>
              </>
            )}
            {isProductsView && (
              <>
                {onManagePromotionsSelected && (
                  <button
                    type="button"
                    onClick={() => onManagePromotionsSelected(selectedIds)}
                    disabled={selectedIds.length === 0 || isPromotionJobActive}
                    className="flex items-center gap-2 rounded-md border border-violet-200 px-4 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-60"
                  >
                    Manage Promotions
                  </button>
                )}
                {onSyncSelectedEbayAds && (
                  <button
                    onClick={() => void onSyncSelectedEbayAds(selectedIds)}
                    disabled={isEbayAdsSyncing || selectedIds.length === 0}
                    className="px-4 py-2 border border-blue-200 text-blue-700 text-sm font-medium rounded-md hover:bg-blue-50 transition-colors disabled:opacity-60 flex items-center gap-2"
                  >
                    {isEbayAdsSyncing ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Syncing Ads...
                      </>
                    ) : (
                      <>
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
                        Sync {selectedIds.length} Ad{selectedIds.length === 1 ? "" : "s"}
                      </>
                    )}
                  </button>
                )}
                {onBulkEditSelected && (
                  <button
                    onClick={() => onBulkEditSelected(selectedIds)}
                    disabled={selectedIds.length === 0}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors disabled:opacity-60 flex items-center gap-2"
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
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 7.125 16.875 4.5"
                      />
                    </svg>
                    Bulk Edit
                  </button>
                )}
                {selectedImportedCount > 0 && (
                  <button
                    onClick={handleBulkHoldSelected}
                    disabled={isBulkHolding}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                  >
                    {isBulkHolding ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Holding...
                      </>
                    ) : (
                      `Put ${selectedImportedCount} On Hold`
                    )}
                  </button>
                )}
                {selectedOnHoldCount > 0 && (
                  <button
                    onClick={handleBulkResumeSelected}
                    disabled={isBulkResuming}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                  >
                    {isBulkResuming ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Resuming...
                      </>
                    ) : (
                      `Resume ${selectedOnHoldCount} On Hold`
                    )}
                  </button>
                )}
                {selectedListedCount > 0 && (
                  <button
                    onClick={handleBulkRemoveFromListflowSelected}
                    disabled={isBulkRemovingListflow || isBulkEnding}
                    className="flex items-center gap-2 rounded-md border border-quaternary px-4 py-2 text-sm font-medium text-quaternary transition-colors hover:bg-quaternary-soft disabled:opacity-60"
                  >
                    {isBulkRemovingListflow ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Removing...
                      </>
                    ) : (
                      "Remove from ListFlow"
                    )}
                  </button>
                )}
                {selectedListedCount > 0 && (
                  <button
                    onClick={handleBulkEndAndRemoveSelected}
                    disabled={isBulkEnding || isBulkRemovingListflow}
                    className="flex items-center gap-2 rounded-md bg-quaternary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-quaternary-hover disabled:opacity-60"
                  >
                    {isBulkEnding ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Queueing...
                      </>
                    ) : (
                      "End on eBay & Remove"
                    )}
                  </button>
                )}
                <button
                  onClick={handleBulkPriceCheck}
                  disabled={isBulkPriceChecking}
                  title={selectedPriceCheckSummary?.message}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {isBulkPriceChecking ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Queueing...
                    </>
                  ) : (
                    selectedPriceCheckSummary &&
                    selectedPriceCheckSummary.eligibleCount > 0
                      ? `Check ${selectedPriceCheckSummary.eligibleCount} Price${
                          selectedPriceCheckSummary.eligibleCount === 1
                            ? ""
                            : "s"
                        }`
                      : "Cannot Check Selected"
                  )}
                </button>
                {selectedPendingCount > 0 && (
                  <>
                    <button
                      onClick={handleBulkApplySelected}
                      disabled={isBulkApplying || isBulkDismissing}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                    >
                      {isBulkApplying ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Applying...
                        </>
                      ) : (
                        `Apply ${selectedPendingCount} Pending`
                      )}
                    </button>
                    <button
                      onClick={handleBulkDismissSelected}
                      disabled={isBulkApplying || isBulkDismissing}
                      className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors disabled:opacity-60 flex items-center gap-2"
                    >
                      {isBulkDismissing ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Dismissing...
                        </>
                      ) : (
                        `Dismiss ${selectedPendingCount} Pending`
                      )}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
