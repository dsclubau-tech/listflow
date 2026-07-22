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
import Button from "@/components/ui/Button";

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
      <section className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-300" />
        <div className="flex flex-col gap-5 p-5 md:p-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-gray-950">
                Drafts
              </h1>
              <span className="inline-flex min-h-7 items-center rounded-full bg-orange-50 px-3 text-sm font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">
                {products.length} {products.length === 1 ? "product" : "products"}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              Review Amazon product details, prepare listings, and follow each
              eBay upload without leaving this page.
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto">
            <Button
              onClick={() => openAddProduct("normal")}
              disabled={isBackgroundImportActive}
              variant="primary"
              size="md"
              fullWidth
              className="xl:min-w-40"
              icon={
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              }
            >
              Normal Upload
            </Button>
            <Button
              onClick={() => openAddProduct("advanced")}
              disabled={isBackgroundImportActive}
              variant="secondary"
              size="md"
              fullWidth
              className="xl:min-w-40"
            >
              Advanced Upload
            </Button>
          </div>
        </div>
      </section>

      {backgroundImport && (
        <div
          className={`mb-5 rounded-2xl border px-4 py-4 shadow-sm ${
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
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
