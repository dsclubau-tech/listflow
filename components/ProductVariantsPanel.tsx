/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useState } from "react";
import EditVariantModal from "@/components/EditVariantModal";
import { calculateNetProfit } from "@/lib/variant-pricing";
import type { VariantRecord } from "@/types/variant";

interface ProductVariantsPanelProps {
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

const variantCache = new Map<string, VariantRecord[]>();
const variantRequests = new Map<string, Promise<VariantRecord[]>>();

function toNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requestVariants(productId: string) {
  const activeRequest = variantRequests.get(productId);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const response = await fetch(`/api/products/${productId}/variants`, {
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as
      | VariantRecord[]
      | { error?: string };

    if (!response.ok || !Array.isArray(data)) {
      throw new Error(
        !Array.isArray(data) && data.error
          ? data.error
          : "Failed to load variants.",
      );
    }

    variantCache.set(productId, data);
    return data;
  })().finally(() => {
    variantRequests.delete(productId);
  });

  variantRequests.set(productId, request);
  return request;
}

export default function ProductVariantsPanel({
  product,
}: ProductVariantsPanelProps) {
  const cachedVariants = variantCache.get(product.id);
  const [variants, setVariants] = useState<VariantRecord[]>(
    () => cachedVariants ?? [],
  );
  const [productStatus, setProductStatus] = useState(
    product.status ?? "IMPORTED",
  );
  const [loading, setLoading] = useState(() => !cachedVariants);
  const [error, setError] = useState<string | null>(null);
  const [editingVariant, setEditingVariant] =
    useState<VariantRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadVariants = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const data = await requestVariants(product.id);
      setVariants(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Network error while loading variants.",
      );
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    const cached = variantCache.get(product.id);
    if (cached) {
      setVariants(cached);
      setLoading(false);
    } else {
      setVariants([]);
      setLoading(true);
    }

    void loadVariants(!cached);
  }, [loadVariants, product.id]);

  useEffect(() => {
    if (product.status) setProductStatus(product.status);
  }, [product.status]);

  function handleSaved(
    variant: VariantRecord,
    _mode: "create" | "edit",
    newProductStatus?: string,
  ) {
    if (newProductStatus) setProductStatus(newProductStatus);

    setVariants((current) => {
      const next = current.map((item) =>
        item.id === variant.id ? variant : item,
      );
      variantCache.set(product.id, next);
      return next;
    });
    setEditingVariant(null);
  }

  async function handleDelete(variant: VariantRecord) {
    if (!window.confirm(`Delete variant "${variant.title}"? This cannot be undone.`)) {
      return;
    }

    setDeletingId(variant.id);
    setError(null);

    try {
      const response = await fetch(
        `/api/products/${product.id}/variants/${variant.id}`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete variant.");
      }

      setVariants((current) => {
        const next = current.filter((item) => item.id !== variant.id);
        variantCache.set(product.id, next);
        return next;
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Network error while deleting variant.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Variants</h3>
        <p className="text-sm text-gray-500">
          Edit pricing, automation, and inventory details for each variant.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
        <div
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          role="status"
          aria-label="Loading variants"
        >
          {[0, 1].map((row) => (
            <div key={row} className="flex animate-pulse items-center gap-4 motion-reduce:animate-none">
              <div className="h-12 w-12 rounded-lg bg-gray-200" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-40 max-w-full rounded bg-gray-200" />
                <div className="h-3 w-24 rounded bg-gray-100" />
              </div>
              <div className="h-8 w-20 rounded bg-gray-100" />
            </div>
          ))}
          <span className="sr-only">Loading variants...</span>
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          No variants are available for this product yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
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
                      {productStatus === "ON_HOLD" ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                          On Hold
                        </span>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            variant.status === "IN_STOCK"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {variant.status === "IN_STOCK" ? "In Stock" : "Out of Stock"}
                        </span>
                      )}
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
                          onClick={() => setEditingVariant(variant)}
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
        isOpen={editingVariant !== null}
        productId={product.id}
        productTitle={product.title}
        isProductOnHold={productStatus === "ON_HOLD"}
        defaultBuyPrice={toNumber(product.price)}
        defaultQuantity={product.quantity}
        defaultImages={product.images}
        defaultSku={product.asin || null}
        variant={editingVariant}
        onClose={() => setEditingVariant(null)}
        onSaved={handleSaved}
      />
    </>
  );
}
