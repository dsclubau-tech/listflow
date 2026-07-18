"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import AddProductModal from "@/components/AddProductModal";
import type { AddProductMode, ScrapedProduct } from "@/components/AddProductModal";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";
import { createDraftFromScrapedProduct } from "@/components/draft-autosave";

interface DashboardClientProps {
  products: SerializedProductRow[];
}

export default function DashboardClient({ products }: DashboardClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addProductMode, setAddProductMode] =
    useState<AddProductMode>("normal");
  const [autoExpandProductId, setAutoExpandProductId] = useState<string | null>(null);
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const handleScraped = async (data: ScrapedProduct) => {
    const result = await createDraftFromScrapedProduct(data);
    setAutoExpandProductId(result.productId);
    setIsModalOpen(false);
    showToast("Draft created. Review and save changes when ready.", "success");
    router.refresh();
  };

  function openAddProduct(mode: AddProductMode) {
    setAddProductMode(mode);
    setIsModalOpen(true);
  }

  return (
    <>
      {/* Header */}
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
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
          >
            + Normal Upload
          </button>
          <button
            onClick={() => openAddProduct("advanced")}
            className="px-4 py-2 border border-gray-300 bg-white text-gray-800 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            Advanced Upload
          </button>
        </div>
      </div>

      {/* Drafts Table */}
      <DraftsTable
        products={products}
        onToast={showToast}
        autoExpandProductId={autoExpandProductId}
      />

      {/* URL Input Modal */}
      <AddProductModal
        isOpen={isModalOpen}
        mode={addProductMode}
        onClose={() => setIsModalOpen(false)}
        onScraped={handleScraped}
        onBackgroundStarted={() =>
          showToast("Normal upload started in the background.", "success")
        }
        onBackgroundFailed={(message) => showToast(message, "error")}
      />

      {/* Toast notification */}
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
