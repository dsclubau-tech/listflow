"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product, Store, User } from "@/app/generated/prisma/client";

type ProductWithRelations = Product & {
  store: Store;
  createdBy: User;
};

interface DraftsTableProps {
  products: ProductWithRelations[];
  onToast: (message: string, variant: "success" | "error") => void;
}

const storeBadgeColors: Record<string, string> = {
  "Store 1": "bg-blue-100 text-blue-800",
  "Store 2": "bg-purple-100 text-purple-800",
  "Store 3": "bg-orange-100 text-orange-800",
};

const statusBadgeColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  IMPORTED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

export default function DraftsTable({ products, onToast }: DraftsTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

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
          No drafts yet. Click &lsquo;Add Product&rsquo; to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-3 text-left w-10">
              <input type="checkbox" className="rounded border-gray-300" disabled />
            </th>
            <th className="px-4 py-3 text-left w-14">Image</th>
            <th className="px-4 py-3 text-left">Title</th>
            <th className="px-4 py-3 text-left">Store</th>
            <th className="px-4 py-3 text-left">Created by</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              key={product.id}
              className="bg-white border-b hover:bg-gray-50 transition-colors"
            >
              {/* Checkbox */}
              <td className="px-4 py-3">
                <input type="checkbox" className="rounded border-gray-300" />
              </td>

              {/* Image */}
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

              {/* Title */}
              <td className="px-4 py-3">
                <span
                  className="text-sm font-medium text-gray-900 truncate max-w-xs block"
                  title={product.title}
                >
                  {product.title}
                </span>
              </td>

              {/* Store badge */}
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    storeBadgeColors[product.store.name] || "bg-gray-100 text-gray-800"
                  }`}
                >
                  {product.store.name}
                </span>
              </td>

              {/* Created by */}
              <td className="px-4 py-3">
                <span className="text-sm text-gray-500">
                  {product.createdBy.name}
                </span>
              </td>

              {/* Status badge */}
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    statusBadgeColors[product.status] || "bg-gray-100 text-gray-600"
                  }`}
                >
                  {product.status}
                </span>
              </td>

              {/* Actions */}
              <td className="px-4 py-3">
                {loadingId === product.id ? (
                  <button
                    disabled
                    className="bg-gray-400 text-white text-sm px-3 py-1 rounded flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading…
                  </button>
                ) : product.status === "IMPORTED" ? (
                  <span className="inline-flex items-center px-3 py-1 rounded text-sm font-medium bg-green-100 text-green-700">
                    Imported ✓
                  </span>
                ) : product.status === "FAILED" ? (
                  <button
                    onClick={() => handleImport(product.id)}
                    className="bg-red-500 hover:bg-red-600 text-white text-sm px-3 py-1 rounded transition-colors"
                  >
                    Retry
                  </button>
                ) : (
                  <button
                    onClick={() => handleImport(product.id)}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-3 py-1 rounded transition-colors"
                  >
                    Import
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
