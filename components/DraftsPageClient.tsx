"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DraftsTable from "@/components/DraftsTable";
import AddProductModal from "@/components/AddProductModal";
import type { ScrapedProduct } from "@/components/AddProductModal";
import DraftEditForm from "@/components/DraftEditForm";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { Product, Store, User } from "@/app/generated/prisma/client";

type ProductWithRelations = Product & {
  store: Store;
  createdBy: User;
};

interface DraftsPageClientProps {
  products: ProductWithRelations[];
}

export default function DraftsPageClient({
  products,
}: DraftsPageClientProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDraftFormOpen, setIsDraftFormOpen] = useState(false);
  const [scrapedData, setScrapedData] = useState<ScrapedProduct | null>(null);
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const handleScraped = (data: ScrapedProduct) => {
    setScrapedData(data);
    setIsModalOpen(false);
    setIsDraftFormOpen(true);
  };

  const handleDraftSuccess = () => {
    setIsDraftFormOpen(false);
    setScrapedData(null);
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
          onSuccess={handleDraftSuccess}
          onError={handleDraftError}
          onClose={() => {
            setIsDraftFormOpen(false);
            setScrapedData(null);
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
