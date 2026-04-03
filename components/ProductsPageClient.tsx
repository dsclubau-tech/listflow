"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";

interface ProductsPageClientProps {
  products: SerializedProductRow[];
}

export default function ProductsPageClient({
  products,
}: ProductsPageClientProps) {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingPrices, setIsCheckingPrices] = useState(false);
  const { toast, showToast, hideToast } = useToast();

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
      setIsCheckingPrices(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <span className="text-sm text-gray-500">
            ({products.length} active listings)
          </span>
        </div>
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
          {isCheckingPrices ? "Checking Prices..." : "Check Prices Now"}
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

      <DraftsTable products={products} onToast={showToast} view="products" />

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
