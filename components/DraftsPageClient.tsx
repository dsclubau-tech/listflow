"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import AddProductModal from "@/components/AddProductModal";
import type { AddProductMode, ScrapedProduct } from "@/components/AddProductModal";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";
import { createDraftFromScrapedProduct } from "@/components/draft-autosave";
import { removeImportedDraftProduct } from "@/lib/draft-products-state";
import ActionProgressBar from "@/components/ActionProgressBar";
import { useTimedActionProgress } from "@/hooks/useTimedActionProgress";
import type { ExistingProductConflict } from "@/types/product-duplicate";

interface DraftsPageClientProps {
  products: SerializedProductRow[];
}

export default function DraftsPageClient({
  products,
}: DraftsPageClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addProductMode, setAddProductMode] =
    useState<AddProductMode>("normal");
  const [autoExpandProductId, setAutoExpandProductId] = useState<string | null>(null);
  const [visibleProducts, setVisibleProducts] = useState(products);
  const [backgroundImport, setBackgroundImport] = useState<{
    status: "reading" | "saving" | "success" | "error";
    url: string;
    message?: string;
    existing?: ExistingProductConflict;
  } | null>(null);
  const didRunMaintenance = useRef(false);
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();
  const backgroundImportPercent = useTimedActionProgress(
    backgroundImport?.status === "reading",
    {
      initialPercent: 8,
      maxWaitingPercent: 84,
      stepPercent: 7,
    },
  );
  const isBackgroundImportActive =
    backgroundImport?.status === "reading" ||
    backgroundImport?.status === "saving";

  useEffect(() => {
    setVisibleProducts(products);
  }, [products]);

  useEffect(() => {
    if (didRunMaintenance.current) return;
    didRunMaintenance.current = true;

    const controller = new AbortController();

    void fetch("/api/drafts/maintenance", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { repaired?: number };
        if (data.repaired && data.repaired > 0) {
          router.refresh();
        }
      })
      .catch(() => {
        // Maintenance is best effort and must never block the Drafts page.
      });

    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    if (backgroundImport?.status !== "success") {
      return;
    }

    const timeout = window.setTimeout(() => setBackgroundImport(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [backgroundImport?.status]);

  const handleScraped = async (
    data: ScrapedProduct,
    context: { background: boolean },
  ) => {
    if (context.background) {
      setBackgroundImport((current) =>
        current
          ? {
              ...current,
              status: "saving",
              message: "Saving the imported product as a draft.",
            }
          : current,
      );
    }

    const result = await createDraftFromScrapedProduct(data);
    setAutoExpandProductId(result.productId);
    setIsModalOpen(false);
    if (context.background) {
      setBackgroundImport((current) =>
        current
          ? {
              ...current,
              status: "success",
              message: "Draft created successfully.",
            }
          : current,
      );
    } else {
      showToast("Draft created. Review and save changes when ready.", "success");
    }
    router.refresh();
  };

  function openExistingProduct(existing: ExistingProductConflict) {
    setIsModalOpen(false);
    setBackgroundImport(null);

    if (existing.location === "drafts") {
      setAutoExpandProductId(existing.id);
      return;
    }

    router.push(`/products?productId=${encodeURIComponent(existing.id)}`);
  }

  function openAddProduct(mode: AddProductMode) {
    setAddProductMode(mode);
    setIsModalOpen(true);
  }

  const handleDraftImported = (productId: string) => {
    setVisibleProducts((current) =>
      removeImportedDraftProduct(current, productId)
    );
    setAutoExpandProductId((current) => (current === productId ? null : current));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Drafts</h1>
          <span className="text-sm text-gray-500">
            ({products.length} products)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openAddProduct("normal")}
            disabled={isBackgroundImportActive}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Normal Upload
          </button>
          <button
            onClick={() => openAddProduct("advanced")}
            disabled={isBackgroundImportActive}
            className="px-4 py-2 border border-gray-300 bg-white text-gray-800 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Advanced Upload
          </button>
        </div>
      </div>

      {backgroundImport && (
        <div
          className={`mb-5 rounded-lg border px-4 py-3 ${
            backgroundImport.status === "error"
              ? "border-red-200 bg-red-50"
              : backgroundImport.status === "success"
                ? "border-emerald-200 bg-emerald-50"
                : "border-orange-200 bg-orange-50"
          }`}
          aria-live="polite"
        >
          <ActionProgressBar
            label={
              backgroundImport.status === "reading"
                ? "Reading Amazon"
                : backgroundImport.status === "saving"
                  ? "Saving draft"
                  : backgroundImport.status === "success"
                    ? "Draft created"
                    : "Draft import failed"
            }
            percent={
              backgroundImport.status === "reading"
                ? backgroundImportPercent
                : backgroundImport.status === "saving"
                  ? 92
                  : backgroundImport.status === "success"
                    ? 100
                    : 0
            }
            tone={
              backgroundImport.status === "error"
                ? "red"
                : backgroundImport.status === "success"
                  ? "green"
                  : "orange"
            }
            detail={
              backgroundImport.message ||
              "Fetching About this item and Product Description from Amazon."
            }
          />
          {backgroundImport.status === "error" && (
            <div className="mt-3 flex items-center gap-3">
              {backgroundImport.existing ? (
                <button
                  type="button"
                  onClick={() => openExistingProduct(backgroundImport.existing!)}
                  className="text-sm font-semibold text-red-700 underline underline-offset-2"
                >
                  Open existing product
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBackgroundImport(null);
                    openAddProduct("normal");
                  }}
                  className="text-sm font-semibold text-red-700 underline underline-offset-2"
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => setBackgroundImport(null)}
                className="text-sm text-gray-600"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <DraftsTable
        products={visibleProducts}
        onToast={showToast}
        view="drafts"
        autoExpandProductId={autoExpandProductId}
        onDraftImported={handleDraftImported}
      />

      <AddProductModal
        isOpen={isModalOpen}
        mode={addProductMode}
        onClose={() => setIsModalOpen(false)}
        onScraped={handleScraped}
        onBackgroundStarted={(url) =>
          setBackgroundImport({ status: "reading", url })
        }
        onBackgroundFailed={(message, existing) =>
          setBackgroundImport((current) => ({
            status: "error",
            url: current?.url ?? "",
            message,
            existing,
          }))
        }
        onOpenExisting={openExistingProduct}
      />

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
