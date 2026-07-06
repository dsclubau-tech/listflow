"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import AddProductModal from "@/components/AddProductModal";
import type { ScrapedProduct } from "@/components/AddProductModal";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { SerializedProductRow } from "@/types/product-row";
import { createDraftFromScrapedProduct } from "@/components/draft-autosave";
import { removeImportedDraftProduct } from "@/lib/draft-products-state";

interface DraftsPageClientProps {
  products: SerializedProductRow[];
}

export default function DraftsPageClient({
  products,
}: DraftsPageClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [autoExpandProductId, setAutoExpandProductId] = useState<string | null>(null);
  const [visibleProducts, setVisibleProducts] = useState(products);
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  useEffect(() => {
    setVisibleProducts(products);
  }, [products]);

  const handleScraped = async (data: ScrapedProduct) => {
    const result = await createDraftFromScrapedProduct(data);
    setAutoExpandProductId(result.productId);
    setIsModalOpen(false);
    showToast("Draft created. Review and save changes when ready.", "success");
    router.refresh();
  };

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
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
        >
          + Add Product
        </button>
      </div>

      <DraftsTable
        products={visibleProducts}
        onToast={showToast}
        view="drafts"
        autoExpandProductId={autoExpandProductId}
        onDraftImported={handleDraftImported}
      />

      <AddProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onScraped={handleScraped}
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
