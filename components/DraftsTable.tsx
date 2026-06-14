/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import InlineEditForm from "@/components/InlineEditForm";
import { calculateNetProfit } from "@/lib/variant-pricing";
import type { SerializedProductRow } from "@/types/product-row";

interface DraftsTableProps {
  products: SerializedProductRow[];
  onToast: (message: string, variant: "success" | "error") => void;
  view?: "drafts" | "products";
  onSelectionChange?: (selectedIds: string[]) => void;
  onPriceCheckSelected?: (productIds: string[]) => Promise<void>;
  isPriceCheckJobActive?: boolean;
}

const storeBadgeColors: Record<string, string> = {
  "Store 1": "bg-blue-100 text-blue-800",
  "Store 2": "bg-purple-100 text-purple-800",
  "Store 3": "bg-orange-100 text-orange-800",
};

const statusBadgeLabels: Record<string, string> = {
  DRAFT: "Draft",
  IMPORTED: "Imported",
  FAILED: "Failed",
  ON_HOLD: "On Hold",
};

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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, {
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

  return date.toLocaleString(undefined, {
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
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gray-900 text-[10px] font-bold leading-none text-white"
      >
        a
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-blue-600 text-[9px] font-bold leading-none text-white"
    >
      e
    </span>
  );
}

function ItemIdCell({ product }: { product: SerializedProductRow }) {
  const asin = product.asin?.trim();
  const ebayItemId = product.ebayItemId?.trim();

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <PlatformIcon platform="amazon" />
        {asin ? (
          <a
            href={`https://www.amazon.com.au/dp/${asin}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="block truncate font-mono text-gray-700 hover:text-orange-600 hover:underline"
            title={`Open Amazon ASIN ${asin}`}
          >
            {asin}
          </a>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <PlatformIcon platform="ebay" />
        {ebayItemId ? (
          <a
            href={`https://www.ebay.com.au/itm/${ebayItemId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="block truncate font-mono text-gray-700 hover:text-blue-600 hover:underline"
            title={`Open eBay item ${ebayItemId}`}
          >
            {ebayItemId}
          </a>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>
    </div>
  );
}

function PriceCell({ product }: { product: SerializedProductRow }) {
  const variants = product.variants ?? [];
  const buyPrices = variants
    .map((variant) => parseMoney(variant.buyPrice))
    .filter((value): value is number => value !== null);
  const sellPrices = variants
    .map((variant) => parseMoney(variant.sellPrice))
    .filter((value): value is number => value !== null);
  const fallbackBuyPrice = parseMoney(product.amazonPrice ?? product.price);
  const fallbackSellPrice = parseMoney(product.price);

  return (
    <div className="space-y-1 text-xs font-medium leading-5">
      <div className="whitespace-nowrap">
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
      <div className="whitespace-nowrap">
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
  const profits = (product.variants ?? [])
    .map((variant) => {
      const buyPrice = parseMoney(variant.buyPrice);
      const sellPrice = parseMoney(variant.sellPrice);

      if (buyPrice === null || sellPrice === null) {
        return null;
      }

      return calculateNetProfit({
        buyPrice,
        sellPrice,
        feesPercent: variant.feesPercent ?? 0,
        feesFixed: variant.feesFixed ?? 0,
      });
    })
    .filter((value): value is number => value !== null);

  if (profits.length === 0) {
    const buyPrice = parseMoney(product.amazonPrice);
    const sellPrice = parseMoney(product.price);

    if (buyPrice === null || sellPrice === null) {
      return <span className="text-sm text-gray-400">-</span>;
    }

    return (
      <span className="whitespace-nowrap text-sm font-medium text-gray-700">
        {formatMoney(sellPrice - buyPrice)}
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-sm font-medium text-gray-700">
      {formatMoneyRange(profits)}
    </span>
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

  if (lastHistory && !lastHistory.appliedAt) {
    return {
      label: "Pending review",
      badgeClass: "bg-amber-100 text-amber-800",
      priceHistoryId: lastHistory.id,
      detail: getAmazonChangeDetail(product),
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

function canCheckProductPrice(product: SerializedProductRow) {
  return (
    product.status === "IMPORTED" &&
    Boolean(product.asin) &&
    (product._count?.variants ?? 0) > 0
  );
}

export default function DraftsTable({
  products,
  onToast,
  view = "drafts",
  onSelectionChange,
  onPriceCheckSelected,
  isPriceCheckJobActive = false,
}: DraftsTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkPriceChecking, setIsBulkPriceChecking] = useState(false);
  const [reviewingPriceHistoryId, setReviewingPriceHistoryId] =
    useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [isBulkDismissing, setIsBulkDismissing] = useState(false);
  const [isBulkResuming, setIsBulkResuming] = useState(false);
  const [isBulkHolding, setIsBulkHolding] = useState(false);
  const [notingProduct, setNotingProduct] =
    useState<SerializedProductRow | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const router = useRouter();

  const isDraftsView = view === "drafts";
  const isProductsView = view === "products";
  const hasSelectionColumn = isDraftsView || isProductsView;

  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [onSelectionChange, selectedIds]);

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
    setExpandedProductId((prev) => (prev === productId ? null : productId));
  }

  async function handleImport(productId: string) {
    setLoadingId(productId);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();

      if (res.ok) {
        onToast("Product imported to eBay successfully!", "success");
        router.refresh();
      } else {
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

  async function handleEndListing(productId: string) {
    const confirmed = window.confirm(
      "Are you sure you want to end this listing on eBay and permanently remove it from ListFlow? This action cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setEndingId(productId);

    try {
      const res = await fetch(`/api/products/${productId}/end`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        onToast("Listing ended on eBay and removed from ListFlow", "success");
        setSelectedIds((prev) => prev.filter((id) => id !== productId));
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
  const allSelectableIds = useMemo(
    () => selectableProducts.map((product) => product.id),
    [selectableProducts],
  );
  const selectableIdSet = useMemo(
    () => new Set(allSelectableIds),
    [allSelectableIds],
  );
  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setSelectedIds((currentIds) => {
      const nextIds = currentIds.filter((id) => selectableIdSet.has(id));
      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });
  }, [selectableIdSet]);

  function toggleSelect(productId: string) {
    if (!selectableIdSet.has(productId)) {
      return;
    }

    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(allSelectableIds);
  }

  const selectedPendingCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return products.filter(
      (product) =>
        selectedIds.includes(product.id) &&
        (product.priceHistory?.length ?? 0) > 0 &&
        product.priceHistory?.some((h) => !h.appliedAt)
    ).length;
  }, [isProductsView, products, selectedIds]);

  const selectedOnHoldCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return products.filter(
      (product) =>
        selectedIds.includes(product.id) && product.status === "ON_HOLD"
    ).length;
  }, [isProductsView, products, selectedIds]);

  const selectedImportedCount = useMemo(() => {
    if (!isProductsView) {
      return 0;
    }

    return products.filter(
      (product) =>
        selectedIds.includes(product.id) && product.status === "IMPORTED"
    ).length;
  }, [isProductsView, products, selectedIds]);

  async function handleBulkApplySelected() {
    const idsWithPending = products
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          (product.priceHistory?.length ?? 0) > 0 &&
          product.priceHistory?.some((h) => !h.appliedAt)
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
    const idsWithPending = products
      .filter(
        (product) =>
          selectedIds.includes(product.id) &&
          (product.priceHistory?.length ?? 0) > 0 &&
          product.priceHistory?.some((h) => !h.appliedAt)
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
    const idsToCheck = selectedIds.filter((id) => {
      const p = products.find((prod) => prod.id === id);
      return p && canCheckProductPrice(p);
    });

    if (idsToCheck.length === 0) {
      onToast("Select at least one tracked product first.", "error");
      return;
    }

    setIsBulkPriceChecking(true);

    try {
      if (onPriceCheckSelected) {
        await onPriceCheckSelected(idsToCheck);
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
    const onHoldIds = products
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
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk resume failed.", "error");
        router.refresh();
        return;
      }

      const failureCount = data.failed ?? 0;
      const resumedCount = data.resumed ?? 0;

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
    const importedIds = products
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
        error?: string;
      };

      if (!res.ok) {
        onToast(data.error || "Bulk hold failed.", "error");
        router.refresh();
        return;
      }

      const failureCount = data.failed ?? 0;
      const heldCount = data.held ?? 0;

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
    setBulkProgress(0);
    setBulkTotal(selected.length);

    let succeeded = 0;
    let failed = 0;
    let skippedAmazon = 0;

    for (let i = 0; i < selected.length; i += 1) {
      const product = selected[i];
      const plainText = product.description.replace(/<[^>]*>/g, "");

      if (/amazon/i.test(plainText)) {
        skippedAmazon += 1;
        failed += 1;
        setBulkProgress(i + 1);
        continue;
      }

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id }),
        });

        if (res.ok) {
          succeeded += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }

      setBulkProgress(i + 1);
    }

    router.refresh();
    setSelectedIds([]);
    setBulkImporting(false);

    onToast(
      `Import complete - ${succeeded} succeeded, ${failed} failed`,
      succeeded > 0 ? "success" : "error"
    );

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
      <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
        <svg
          className="w-12 h-12 mx-auto text-gray-300 mb-4"
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
        <p className="text-gray-500 text-sm">
          {isDraftsView
            ? "No drafts yet. Click 'Add Product' to get started."
            : "No active listings yet. Import a draft to publish it on eBay."}
        </p>
      </div>
    );
  }

  const columnCount = isProductsView ? 13 : 8;

  return (
    <>
      {selectedIds.length > 0 && (
        <p className="text-sm text-gray-500 mb-2">
          {selectedIds.length} selected
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className={isProductsView ? "w-full min-w-[1240px] table-fixed" : "w-full"}>
          {isProductsView && (
            <colgroup>
              <col className="w-[34px]" />
              <col className="w-7" />
              <col className="w-[58px]" />
              <col className="w-[250px]" />
              <col className="w-24" />
              <col className="w-[72px]" />
              <col className="w-[108px]" />
              <col className="w-[72px]" />
              <col className="w-[84px]" />
              <col className="w-[88px]" />
              <col className="w-[214px]" />
              <col className="w-11" />
              <col className="w-[102px]" />
            </colgroup>
          )}
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              {hasSelectionColumn && (
                <th className="px-3 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={allSelectableIds.length === 0}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                </th>
              )}
              <th className="px-2 py-3 text-left w-10" />
              <th className="px-3 py-3 text-left w-14">Image</th>
              <th className="px-3 py-3 text-left">Title</th>
              {isProductsView && (
                <>
                  <th className="px-3 py-3 text-left">Price</th>
                  <th className="px-3 py-3 text-left">Profit</th>
                  <th className="px-3 py-3 text-left">Item ID</th>
                </>
              )}
              <th className="px-3 py-3 text-left">Store</th>
              <th className="px-3 py-3 text-left">
                {isProductsView ? "Uploaded" : "Created by"}
              </th>
              <th className="px-3 py-3 text-left">Status</th>
              {isProductsView && (
                <>
                  <th className="px-3 py-3 text-left">Price Tracking</th>
                  <th className="px-2 py-3 text-left">Note</th>
                </>
              )}
              <th className="px-3 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const isExpanded = expandedProductId === product.id;
              const isSelected = selectedIds.includes(product.id);
              const isSelectable = selectableIdSet.has(product.id);
              const isFailedDraft =
                isDraftsView && product.status === "FAILED";
              const trackingState = isProductsView
                ? getPriceTrackingState(product)
                : null;

              return (
                <Fragment key={product.id}>
                  <tr
                    className={`border-b transition-colors cursor-pointer ${
                      isExpanded
                        ? "bg-orange-50"
                        : isFailedDraft
                          ? "bg-red-50 hover:bg-red-100"
                          : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => toggleExpand(product.id)}
                  >
                    {hasSelectionColumn && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
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
                          className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                        />
                      </td>
                    )}

                    <td className="px-2 py-3">
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

                    <td className="px-3 py-3">
                      {product.images && product.images.length > 0 ? (
                        <img
                          src={product.images[0]}
                          alt={product.title}
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <div className={isProductsView ? "max-w-[15rem]" : "max-w-xs"}>
                        <span
                          className="text-sm font-medium text-gray-900 truncate block"
                          title={product.title}
                        >
                          {product.title}
                        </span>
                        {isFailedDraft && product.errorMessage && (
                          <span
                            className="mt-1 block truncate text-xs text-red-600"
                            title={product.errorMessage}
                          >
                            {product.errorMessage}
                          </span>
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

                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          storeBadgeColors[product.store.name] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {product.store.name}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <span className="whitespace-nowrap text-sm text-gray-500">
                        {isProductsView
                          ? formatDate(product.uploadedAt) ?? "-"
                          : product.createdBy.name}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(product.status)}`}
                      >
                        {statusBadgeLabels[product.status] || product.status}
                      </span>
                    </td>

                    {isProductsView && trackingState && (
                      <td className="px-3 py-3">
                        <div className="max-w-[13rem]">
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

                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {loadingId === product.id ? (
                          <button
                            disabled
                            className="bg-gray-400 text-white text-sm px-3 py-1 rounded flex items-center gap-1.5"
                          >
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Uploading...
                          </button>
                        ) : product.status === "FAILED" && isDraftsView ? (
                          <button
                            onClick={() => handleImport(product.id)}
                            className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-1 rounded transition-colors"
                          >
                            Retry
                          </button>
                        ) : product.status === "DRAFT" && isDraftsView ? (
                          <button
                            onClick={() => handleImport(product.id)}
                            className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-3 py-1 rounded transition-colors"
                          >
                            Import
                          </button>
                        ) : product.status === "IMPORTED" && !isProductsView ? (
                          <span className="inline-flex items-center px-3 py-1 rounded text-sm font-medium bg-green-100 text-green-700">
                            Imported
                          </span>
                        ) : null}

                        {isProductsView &&
                          (product.status === "IMPORTED" ||
                            product.status === "ON_HOLD") && (
                          <button
                            onClick={() => handleEndListing(product.id)}
                            disabled={endingId === product.id}
                            className="flex items-center gap-1 whitespace-nowrap rounded bg-red-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-40"
                            title="End listing on eBay and remove from ListFlow"
                          >
                            {endingId === product.id ? (
                              <>
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Ending...
                              </>
                            ) : "End & Remove"}
                          </button>
                        )}

                        {isDraftsView && product.status !== "IMPORTED" && (
                          <button
                            onClick={() => handleDelete(product.id)}
                            disabled={deletingId === product.id}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded disabled:opacity-40"
                            title="Delete product"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        )}

                        {product.asin && !isProductsView && (
                          <a
                            href={`https://www.amazon.com.au/dp/${product.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-orange-500 transition-colors p-1 rounded"
                            title="Go to Amazon"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        )}

                        {product.ebayItemId && !isProductsView && (
                          <a
                            href={`https://www.ebay.com.au/itm/${product.ebayItemId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-blue-500 transition-colors p-1 rounded"
                            title="Go to eBay"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={columnCount} className="p-0">
                        <InlineEditForm
                          product={product as never}
                          onCollapse={() => setExpandedProductId(null)}
                        />
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

      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 left-64 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-30 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {selectedIds.length} product(s) selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedIds([])}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
            >
              Deselect All
            </button>
            {isDraftsView && (
              <>
                <button
                  onClick={handleBulkImport}
                  disabled={bulkImporting || isBulkDeleting}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {bulkImporting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Importing {bulkProgress}/{bulkTotal}...
                    </>
                  ) : (
                    "Import Selected"
                  )}
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting || bulkImporting}
                  className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-md hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {isBulkDeleting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    "Delete Selected"
                  )}
                </button>
              </>
            )}
            {isProductsView && (
              <>
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
                <button
                  onClick={handleBulkPriceCheck}
                  disabled={isBulkPriceChecking || isPriceCheckJobActive}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {isBulkPriceChecking || isPriceCheckJobActive ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Checking...
                    </>
                  ) : (
                    "Check Selected Prices"
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
