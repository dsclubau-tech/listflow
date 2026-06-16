"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import AddProductModal from "@/components/AddProductModal";
import type { ScrapedProduct } from "@/components/AddProductModal";
import DraftEditForm from "@/components/DraftEditForm";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";
import { createDraftFromScrapedProduct } from "@/components/draft-autosave";

interface DraftsPageClientProps {
  products: SerializedProductRow[];
}

export default function DraftsPageClient({
  products,
}: DraftsPageClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDraftFormOpen, setIsDraftFormOpen] = useState(false);
  const [scrapedData, setScrapedData] = useState<ScrapedProduct | null>(null);
  const [draftProductId, setDraftProductId] = useState<string | null>(null);
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const handleScraped = async (data: ScrapedProduct) => {
    const result = await createDraftFromScrapedProduct(data);
    setScrapedData(data);
    setDraftProductId(result.productId);
    setIsModalOpen(false);
    setIsDraftFormOpen(true);
    showToast("Draft created. Review and save changes when ready.", "success");
    router.refresh();
  };

  const handleDraftSuccess = () => {
    setIsDraftFormOpen(false);
    setScrapedData(null);
    setDraftProductId(null);
    showToast("Product saved as draft", "success");
    router.refresh();
  };

  const handleDraftError = (message: string) => {
    showToast(message, "error");
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
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
        >
          + Add Product
        </button>
      </div>

      <DraftsTable products={products} onToast={showToast} view="drafts" />

      <AddProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onScraped={handleScraped}
      />

      {scrapedData && (
        <DraftEditForm
          isOpen={isDraftFormOpen}
          scrapedData={scrapedData}
          productId={draftProductId ?? undefined}
          onSuccess={handleDraftSuccess}
          onError={handleDraftError}
          onClose={() => {
            setIsDraftFormOpen(false);
            setScrapedData(null);
            setDraftProductId(null);
            router.refresh();
          }}
        />
      )}

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
