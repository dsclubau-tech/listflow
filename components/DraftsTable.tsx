/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import InlineEditForm from "@/components/InlineEditForm";
import type { SerializedProductRow } from "@/types/product-row";

interface DraftsTableProps {
  products: SerializedProductRow[];
  onToast: (message: string, variant: "success" | "error") => void;
  view?: "drafts" | "products";
  onSelectionChange?: (selectedIds: string[]) => void;
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

function formatChangePercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
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

export default function DraftsTable({
  products,
  onToast,
  view = "drafts",
  onSelectionChange,
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
      "Are you sure you want to end this listing on eBay? The product will return to DRAFT status."
    );

    if (!confirmed) {
      return;
    }

    setEndingId(productId);

    try {
      const res = await fetch(`/api/products/${productId}/end`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        onToast("Listing ended on eBay", "success");
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

  function canCheckProductPrice(product: SerializedProductRow) {
    return (
      product.status === "IMPORTED" &&
      Boolean(product.asin) &&
      (product._count?.variants ?? 0) > 0
    );
  }

  const selectableProducts = isDraftsView
    ? products.filter((product) => product.status !== "IMPORTED")
    : products.filter(canCheckProductPrice);
  const allSelectableIds = selectableProducts.map((product) => product.id);
  const selectableIdSet = new Set(allSelectableIds);
  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selectedIds.includes(id));

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

  async function handleBulkPriceCheck() {
    const idsToCheck = selectedIds.filter((id) => selectableIdSet.has(id));

    if (idsToCheck.length === 0) {
      onToast("Select at least one tracked product first.", "error");
      return;
    }

    setIsBulkPriceChecking(true);

    try {
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

  const columnCount = isProductsView ? 9 : 8;

  return (
    <>
      {selectedIds.length > 0 && (
        <p className="text-sm text-gray-500 mb-2">
          {selectedIds.length} selected
        </p>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              {hasSelectionColumn && (
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={allSelectableIds.length === 0}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left w-10" />
              <th className="px-4 py-3 text-left w-14">Image</th>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Store</th>
              <th className="px-4 py-3 text-left">Created by</th>
              <th className="px-4 py-3 text-left">Status</th>
              {isProductsView && (
                <th className="px-4 py-3 text-left">Price Tracking</th>
              )}
              <th className="px-4 py-3 text-left">Actions</th>
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
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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

                    <td className="px-4 py-3">
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

                    <td className="px-4 py-3">
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

                    <td className="px-4 py-3">
                      <div className="max-w-xs">
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

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          storeBadgeColors[product.store.name] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {product.store.name}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">
                        {product.createdBy.name}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(product.status)}`}
                      >
                        {statusBadgeLabels[product.status] || product.status}
                      </span>
                    </td>

                    {isProductsView && trackingState && (
                      <td className="px-4 py-3">
                        <div className="max-w-xs">
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

                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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

                        {isProductsView && product.status === "IMPORTED" && (
                          <button
                            onClick={() => handleEndListing(product.id)}
                            disabled={endingId === product.id}
                            className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-1 rounded transition-colors disabled:opacity-40 flex items-center gap-1.5"
                            title="End listing on eBay"
                          >
                            {endingId === product.id ? (
                              <>
                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Ending...
                              </>
                            ) : "End"}
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

                        {product.asin && (
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

                        {product.ebayItemId && (
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
              <button
                onClick={handleBulkPriceCheck}
                disabled={isBulkPriceChecking}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {isBulkPriceChecking ? (
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
            )}
          </div>
        </div>
      )}
    </>
  );
}
