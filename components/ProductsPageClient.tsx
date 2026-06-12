"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";

interface ProductsPageClientProps {
  products: SerializedProductRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  importedFilter: "today" | null;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const PAGE_SIZE_STORAGE_KEY = "listflow.products.pageSize";

export default function ProductsPageClient({
  products,
  totalCount,
  page,
  pageSize,
  importedFilter,
}: ProductsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingPrices, setIsCheckingPrices] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const { toast, showToast, hideToast } = useToast();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const listingCountLabel =
    importedFilter === "today" ? "listings added today" : "listings";
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

  const handleCheckPrices = async () => {
    setIsCheckingPrices(true);

    try {
      const body =
        selectedProductIds.length > 0
          ? { productIds: selectedProductIds }
          : { all: true };

      const response = await fetch("/api/price-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        checked?: number;
        changed?: number;
        pendingReview?: number;
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
          : `Checked ${data.checked ?? 0} product${data.checked === 1 ? "" : "s"}. ${data.pendingReview ?? 0} pending review, ${data.failed ?? 0} failed, ${data.skipped ?? 0} unchanged.`,
        data.failed && data.failed > 0 ? "error" : "success"
      );
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to check prices";
      showToast(message, "error");
    } finally {
      setIsCheckingPrices(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <span className="text-sm text-gray-500">
            ({totalCount} {listingCountLabel})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
            disabled={isCheckingPrices}
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
            {isCheckingPrices
              ? "Checking Prices..."
              : selectedProductIds.length > 0
                ? `Check ${selectedProductIds.length} Selected`
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

      <DraftsTable
        products={products}
        onToast={showToast}
        view="products"
        onSelectionChange={setSelectedProductIds}
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
