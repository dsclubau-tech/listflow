"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyRoundCents,
  calculateProfitFixedFromSellPrice,
  calculateSellPrice,
  calculateTotalFees,
  calculateTotalProfit,
} from "@/lib/variant-pricing";
import type { VariantPayload, VariantRecord } from "@/types/variant";

interface EditVariantModalProps {
  isOpen: boolean;
  productId: string;
  productTitle: string;
  defaultBuyPrice: number;
  defaultQuantity: number;
  defaultImages: string[];
  defaultSku: string | null;
  variant: VariantRecord | null;
  onClose: () => void;
  onSaved: (variant: VariantRecord, mode: "create" | "edit") => void;
}

type ModalTab = "pricing" | "general";

interface VariantFormState {
  sku: string;
  title: string;
  imagesText: string;
  buyPrice: string;
  feesPercent: string;
  feesFixed: string;
  profitPercent: string;
  profitFixed: string;
  sellPrice: string;
  quantity: string;
  status: VariantPayload["status"];
  automation: string;
  includeShipping: boolean;
  allowMarketplace: boolean;
  roundCentsEnabled: boolean;
  itemSpecifics: { key: string; value: string }[];
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoneyString(value: number) {
  return value.toFixed(2);
}

function parseImages(imagesText: string) {
  return imagesText
    .split(/\r?\n/)
    .map((image) => image.trim())
    .filter(Boolean);
}

function normalizeItemSpecifics(
  itemSpecifics: { key: string; value: string }[]
) {
  return Object.fromEntries(
    itemSpecifics
      .map((item) => [item.key.trim(), item.value.trim()] as const)
      .filter(([key, value]) => key && value)
  );
}

function buildFormState(props: {
  variant: VariantRecord | null;
  defaultBuyPrice: number;
  defaultQuantity: number;
  defaultImages: string[];
  defaultSku: string | null;
}): VariantFormState {
  const { variant, defaultBuyPrice, defaultQuantity, defaultImages, defaultSku } = props;

  if (variant) {
    return {
      sku: variant.sku || "",
      title: variant.title,
      imagesText: variant.images.join("\n"),
      buyPrice: variant.buyPrice,
      feesPercent: String(variant.feesPercent),
      feesFixed: String(variant.feesFixed),
      profitPercent: String(variant.profitPercent),
      profitFixed: String(variant.profitFixed),
      sellPrice: variant.sellPrice,
      quantity: String(variant.quantity),
      status: variant.status,
      automation: variant.automation || "",
      includeShipping: variant.includeShipping,
      allowMarketplace: variant.allowMarketplace,
      roundCentsEnabled: variant.roundCents !== null,
      itemSpecifics: Object.entries(variant.itemSpecifics || {}).map(([key, value]) => ({
        key,
        value,
      })),
    };
  }

  return {
    sku: defaultSku || "",
    title: "Default",
    imagesText: defaultImages.join("\n"),
    buyPrice: toMoneyString(defaultBuyPrice),
    feesPercent: "0",
    feesFixed: "0",
    profitPercent: "0",
    profitFixed: "0",
    sellPrice: toMoneyString(defaultBuyPrice),
    quantity: String(defaultQuantity),
    status: defaultQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
    automation: "",
    includeShipping: true,
    allowMarketplace: true,
    roundCentsEnabled: false,
    itemSpecifics: [],
  };
}

export default function EditVariantModal({
  isOpen,
  productId,
  productTitle,
  defaultBuyPrice,
  defaultQuantity,
  defaultImages,
  defaultSku,
  variant,
  onClose,
  onSaved,
}: EditVariantModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("pricing");
  const [form, setForm] = useState<VariantFormState>(() =>
    buildFormState({
      variant,
      defaultBuyPrice,
      defaultQuantity,
      defaultImages,
      defaultSku,
    })
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab("pricing");
    setError(null);
    setForm(
      buildFormState({
        variant,
        defaultBuyPrice,
        defaultQuantity,
        defaultImages,
        defaultSku,
      })
    );
  }, [defaultBuyPrice, defaultImages, defaultQuantity, defaultSku, isOpen, variant]);

  const imageUrls = useMemo(() => parseImages(form.imagesText), [form.imagesText]);
  const heroImage = imageUrls[0] || defaultImages[0] || "";
  const roundCents = form.roundCentsEnabled ? 0.99 : null;

  const sellPriceNumber = toNumber(form.sellPrice);
  const totalProfit = calculateTotalProfit({
    sellPrice: sellPriceNumber,
    profitPercent: toNumber(form.profitPercent),
    profitFixed: toNumber(form.profitFixed),
  });
  const totalFees = calculateTotalFees({
    sellPrice: sellPriceNumber,
    feesPercent: toNumber(form.feesPercent),
    feesFixed: toNumber(form.feesFixed),
  });

  function recalculateSellPrice(next: VariantFormState) {
    const sellPrice = calculateSellPrice({
      buyPrice: toNumber(next.buyPrice),
      feesPercent: toNumber(next.feesPercent),
      feesFixed: toNumber(next.feesFixed),
      profitPercent: toNumber(next.profitPercent),
      profitFixed: toNumber(next.profitFixed),
      roundCents: next.roundCentsEnabled ? 0.99 : null,
    });

    return {
      ...next,
      sellPrice: toMoneyString(sellPrice),
    };
  }

  function updatePricingField(
    field: keyof Pick<
      VariantFormState,
      "feesPercent" | "feesFixed" | "profitPercent" | "profitFixed"
    >,
    value: string
  ) {
    setForm((prev) => recalculateSellPrice({ ...prev, [field]: value }));
  }

  function handleSellPriceChange(value: string) {
    setForm((prev) => {
      const normalizedSellPrice = toMoneyString(
        applyRoundCents(toNumber(value), roundCents)
      );
      const profitFixed = calculateProfitFixedFromSellPrice({
        buyPrice: toNumber(prev.buyPrice),
        sellPrice: toNumber(normalizedSellPrice),
        feesPercent: toNumber(prev.feesPercent),
        feesFixed: toNumber(prev.feesFixed),
        profitPercent: toNumber(prev.profitPercent),
      });

      return {
        ...prev,
        sellPrice: normalizedSellPrice,
        profitFixed: toMoneyString(profitFixed),
      };
    });
  }

  function handleRoundCentsChange(checked: boolean) {
    setForm((prev) => recalculateSellPrice({ ...prev, roundCentsEnabled: checked }));
  }

  function updateSpecific(
    index: number,
    field: "key" | "value",
    value: string
  ) {
    setForm((prev) => {
      const nextSpecifics = [...prev.itemSpecifics];
      nextSpecifics[index] = {
        ...nextSpecifics[index],
        [field]: value,
      };

      return {
        ...prev,
        itemSpecifics: nextSpecifics,
      };
    });
  }

  function addSpecific() {
    setForm((prev) => ({
      ...prev,
      itemSpecifics: [...prev.itemSpecifics, { key: "", value: "" }],
    }));
  }

  function removeSpecific(index: number) {
    setForm((prev) => ({
      ...prev,
      itemSpecifics: prev.itemSpecifics.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setError("Variant title is required.");
      setActiveTab("general");
      return;
    }

    const payload: VariantPayload = {
      sku: form.sku.trim() || null,
      title: form.title.trim(),
      images: imageUrls,
      buyPrice: toNumber(form.buyPrice),
      feesPercent: toNumber(form.feesPercent),
      feesFixed: toNumber(form.feesFixed),
      profitPercent: toNumber(form.profitPercent),
      profitFixed: toNumber(form.profitFixed),
      sellPrice: toNumber(form.sellPrice),
      quantity: Math.max(0, Math.floor(toNumber(form.quantity))),
      status: form.status,
      automation: form.automation.trim() || null,
      includeShipping: form.includeShipping,
      allowMarketplace: form.allowMarketplace,
      roundCents,
      itemSpecifics: normalizeItemSpecifics(form.itemSpecifics),
    };

    const url = variant
      ? `/api/products/${productId}/variants/${variant.id}`
      : `/api/products/${productId}/variants`;
    const method = variant ? "PATCH" : "POST";

    setIsSaving(true);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to save variant.");
        return;
      }

      onSaved(data as VariantRecord, variant ? "edit" : "create");
    } catch {
      setError("Network error while saving variant.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-40" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
          <div className="border-b border-gray-200 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {heroImage ? (
                  <img
                    src={heroImage}
                    alt={form.title || productTitle}
                    className="h-16 w-16 rounded-xl object-cover border border-gray-200"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl border border-gray-200 bg-gray-100" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {variant ? "Edit Variant" : "Add Variant"}
                  </p>
                  <h2 className="truncate text-lg font-semibold text-gray-900">
                    {productTitle}
                  </h2>
                  <p className="truncate text-sm text-gray-500">
                    {form.title.trim() || "Untitled variant"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                  Total Profit
                </p>
                <p className="text-xl font-semibold text-emerald-900">
                  ${totalProfit.toFixed(2)}
                </p>
                <p className="text-xs text-emerald-800">
                  Fees ${totalFees.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-6 border-b border-gray-100">
              {(["pricing", "general"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "border-orange-500 text-orange-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "pricing" ? "Pricing" : "General"}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            {activeTab === "pricing" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Buy Price
                  </label>
                  <input
                    type="number"
                    value={form.buyPrice}
                    readOnly
                    className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Sell Price
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sellPrice}
                    onChange={(event) => handleSellPriceChange(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fees %
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.feesPercent}
                    onChange={(event) => updatePricingField("feesPercent", event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Fees Fixed
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.feesFixed}
                    onChange={(event) => updatePricingField("feesFixed", event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Profit %
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.profitPercent}
                    onChange={(event) => updatePricingField("profitPercent", event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Profit Fixed
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.profitFixed}
                    onChange={(event) => updatePricingField("profitFixed", event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={form.includeShipping}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        includeShipping: event.target.checked,
                      }))
                    }
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">Include Shipping</span>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={form.allowMarketplace}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        allowMarketplace: event.target.checked,
                      }))
                    }
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">Allow Marketplace Sellers</span>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.roundCentsEnabled}
                    onChange={(event) => handleRoundCentsChange(event.target.checked)}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">Round Cents to .99</span>
                </label>
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      SKU
                    </label>
                    <input
                      type="text"
                      value={form.sku}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, sku: event.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Quantity
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.quantity}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, quantity: event.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Variant Title
                    </label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, title: event.target.value }))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Inventory Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          status: event.target.value as VariantPayload["status"],
                        }))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="IN_STOCK">In Stock</option>
                      <option value="OUT_OF_STOCK">Out of Stock</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Automation
                  </label>
                  <input
                    type="text"
                    value={form.automation}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, automation: event.target.value }))
                    }
                    placeholder="Optional automation setting"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Variant Images
                  </label>
                  <textarea
                    value={form.imagesText}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, imagesText: event.target.value }))
                    }
                    rows={4}
                    placeholder="One image URL per line"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">
                      Item Specifics
                    </label>
                    <button
                      type="button"
                      onClick={addSpecific}
                      className="text-sm font-medium text-green-600 hover:text-green-800"
                    >
                      + Add Specific
                    </button>
                  </div>

                  <div className="space-y-2">
                    {form.itemSpecifics.map((item, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <input
                          type="text"
                          value={item.key}
                          onChange={(event) =>
                            updateSpecific(index, "key", event.target.value)
                          }
                          placeholder="Name"
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <input
                          type="text"
                          value={item.value}
                          onChange={(event) =>
                            updateSpecific(index, "value", event.target.value)
                          }
                          placeholder="Value"
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeSpecific(index)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    {form.itemSpecifics.length === 0 && (
                      <p className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                        No variant-specific item specifics yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-h-5 text-sm text-red-600">{error}</div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
                >
                  {isSaving ? "Saving..." : variant ? "Save Variant" : "Create Variant"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
