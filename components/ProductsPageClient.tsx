"use client";

import DraftsTable from "@/components/DraftsTable";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import type { Product, Store, User } from "@/app/generated/prisma/client";

type ProductWithRelations = Product & {
  store: Store;
  createdBy: User;
};

interface ProductsPageClientProps {
  products: ProductWithRelations[];
}

export default function ProductsPageClient({
  products,
}: ProductsPageClientProps) {
  const { toast, showToast, hideToast } = useToast();

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <span className="text-sm text-gray-500">
            ({products.length} active listings)
          </span>
        </div>
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
