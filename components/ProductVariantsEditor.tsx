/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useState } from "react";
import EditVariantModal from "@/components/EditVariantModal";
import { calculateNetProfit } from "@/lib/variant-pricing";
import type { VariantRecord } from "@/types/variant";

interface ProductVariantsEditorProps {
  product: {
    id: string;
    title: string;
    price: string | number;
    quantity: number;
    status?: string;
    images: string[];
    asin?: string | null;
  };
}

function toNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ProductVariantsEditor({
  product,
}: ProductVariantsEditorProps) {
  const [variants, setVariants] = useState<VariantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<VariantRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadVariants = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/products/${product.id}/variants`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to load variants.");
        return;
      }

      setVariants(data as VariantRecord[]);
    } catch {
      setError("Network error while loading variants.");
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    void loadVariants();
  }, [loadVariants]);

  function handleSaved(variant: VariantRecord, mode: "create" | "edit") {
    setVariants((prev) => {
      if (mode === "create") {
        return [...prev, variant];
      }

      return prev.map((item) => (item.id === variant.id ? variant : item));
    });
    setModalOpen(false);
    setEditingVariant(null);
  }

  async function handleDelete(variant: VariantRecord) {
    const confirmed = window.confirm(
      `Delete variant "${variant.title}"? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(variant.id);

    try {
      const response = await fetch(
        `/api/products/${product.id}/variants/${variant.id}`,
        {
          method: "DELETE",
        }
      );
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to delete variant.");
        return;
      }

      setVariants((prev) => prev.filter((item) => item.id !== variant.id));
    } catch {
      setError("Network error while deleting variant.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Variants</h3>
          <p className="text-sm text-gray-500">
            Edit pricing, automation, and inventory details for each variant.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingVariant(null);
            setModalOpen(true);
          }}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + Add Variant
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadVariants()}
            className="font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Loading variants...
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Variant</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Sell Price</th>
                <th className="px-4 py-3">Total Profit</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => {
                const totalProfit = calculateNetProfit({
                  buyPrice: toNumber(variant.buyPrice),
                  sellPrice: toNumber(variant.sellPrice),
                  feesPercent: variant.feesPercent,
                  feesFixed: variant.feesFixed,
                });

                return (
                  <tr key={variant.id} className="border-t border-gray-200">
                    <td className="px-4 py-3">
                      {variant.images[0] ? (
                        <img
                          src={variant.images[0]}
                          alt={variant.title}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-gray-100" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{variant.title}</div>
                      {variant.automation && (
                        <div className="text-xs text-gray-500">
                          Automation: {variant.automation}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          variant.status === "IN_STOCK"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {variant.status === "IN_STOCK" ? "In Stock" : "Out of Stock"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {variant.sku || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      ${toNumber(variant.sellPrice).toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium ${
                        totalProfit < 0 ? "text-red-700" : "text-gray-900"
                      }`}
                    >
                      ${totalProfit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVariant(variant);
                            setModalOpen(true);
                          }}
                          className="text-sm font-medium text-orange-600 hover:text-orange-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(variant)}
                          disabled={deletingId === variant.id}
                          className="text-sm font-medium text-quaternary hover:text-quaternary-hover disabled:opacity-40"
                        >
                          {deletingId === variant.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EditVariantModal
        isOpen={modalOpen}
        productId={product.id}
        productTitle={product.title}
        isProductOnHold={product.status === "ON_HOLD"}
        defaultBuyPrice={toNumber(product.price)}
        defaultQuantity={product.quantity}
        defaultImages={product.images}
        defaultSku={product.asin || null}
        variant={editingVariant}
        onClose={() => {
          setModalOpen(false);
          setEditingVariant(null);
        }}
        onSaved={handleSaved}
      />
    </>
  );
}
