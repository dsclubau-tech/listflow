/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyRoundCents,
  calculateNetProfit,
  calculateProfitFixedFromSellPrice,
  calculateSellPrice,
  calculateTotalFees,
} from "@/lib/variant-pricing";
import { dedupeProductImages } from "@/lib/product-images";
import {
  getEffectiveListingQuantity,
  getStoredQuantityAfterEdit,
} from "@/lib/action-center-metrics";
import type { VariantPayload, VariantRecord } from "@/types/variant";

interface EditVariantModalProps {
  isOpen: boolean;
  productId: string;
  productTitle: string;
  isProductOnHold?: boolean;
  defaultBuyPrice: number;
  defaultQuantity: number;
  defaultImages: string[];
  defaultSku: string | null;
  variant: VariantRecord | null;
  onClose: () => void;
  onSaved: (
    variant: VariantRecord,
    mode: "create" | "edit",
    newProductStatus?: string
  ) => void;
}

type ModalTab = "pricing" | "general";

interface SupplierPricingDefaults {
  feesPercent: number;
  feesFixed: number;
  profitPercent: number;
  profitFixed: number;
  minimumProfit: number;
  applyAdditionalProfitToExisting?: boolean;
}

interface VariantFormState {
  sku: string;
  title: string;
  imagesText: string;
  buyPrice: string;
  feesPercent: string;
  feesFixed: string;
  profitPercent: string;
  profitFixed: string;
  minimumProfit: string;
  promotedAdPercent: string;
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

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseImages(imagesText: string) {
  return dedupeProductImages(imagesText.split(/\r?\n/));
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

function recalculateSellPriceForState(next: VariantFormState) {
  const sellPrice = calculateSellPrice({
    buyPrice: toNumber(next.buyPrice),
    feesPercent: toNumber(next.feesPercent),
    feesFixed: toNumber(next.feesFixed),
    profitPercent: toNumber(next.profitPercent),
    profitFixed: toNumber(next.profitFixed),
    roundCents: next.roundCentsEnabled ? 0.99 : null,
    minimumProfit: toNumber(next.minimumProfit),
  });

  return {
    ...next,
    sellPrice: toMoneyString(sellPrice),
  };
}

function buildFormState(props: {
  variant: VariantRecord | null;
  defaultBuyPrice: number;
  defaultQuantity: number;
  defaultImages: string[];
  defaultSku: string | null;
  isProductOnHold: boolean;
  pricingDefaults?: SupplierPricingDefaults | null;
}): VariantFormState {
  const {
    variant,
    defaultBuyPrice,
    defaultQuantity,
    defaultImages,
    defaultSku,
    isProductOnHold,
    pricingDefaults,
  } = props;

  if (variant) {
    return {
      sku: variant.sku || "",
      title: variant.title,
      imagesText: dedupeProductImages(variant.images).join("\n"),
      buyPrice: variant.buyPrice,
      feesPercent: String(variant.feesPercent),
      feesFixed: String(variant.feesFixed),
      profitPercent: String(variant.profitPercent),
      profitFixed: String(variant.profitFixed),
      minimumProfit: String(pricingDefaults?.minimumProfit ?? 0),
      promotedAdPercent: String(variant.promotedAdPercent ?? 0),
      sellPrice: variant.sellPrice,
      quantity: String(
        getEffectiveListingQuantity(
          isProductOnHold ? "ON_HOLD" : "IMPORTED",
          variant.quantity,
        ),
      ),
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

  return recalculateSellPriceForState({
    sku: defaultSku || "",
    title: "Default",
    imagesText: dedupeProductImages(defaultImages).join("\n"),
    buyPrice: toMoneyString(defaultBuyPrice),
    feesPercent: String(pricingDefaults?.feesPercent ?? 0),
    feesFixed: String(pricingDefaults?.feesFixed ?? 0),
    profitPercent: String(pricingDefaults?.profitPercent ?? 0),
    profitFixed: String(pricingDefaults?.profitFixed ?? 0),
    minimumProfit: String(pricingDefaults?.minimumProfit ?? 0),
    promotedAdPercent: "0",
    sellPrice: toMoneyString(defaultBuyPrice),
    quantity: String(
      getEffectiveListingQuantity(
        isProductOnHold ? "ON_HOLD" : "IMPORTED",
        defaultQuantity,
      ),
    ),
    status: defaultQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
    automation: "",
    includeShipping: true,
    allowMarketplace: true,
    roundCentsEnabled: false,
    itemSpecifics: [],
  });
}

export default function EditVariantModal({
  isOpen,
  productId,
  productTitle,
  isProductOnHold = false,
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
      isProductOnHold,
    })
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingDefaults, setPricingDefaults] =
    useState<SupplierPricingDefaults | null>(null);
  const pricingDefaultsRef = useRef<SupplierPricingDefaults | null>(null);
  const [includeAdditionalProfit, setIncludeAdditionalProfit] = useState(false);

  useEffect(() => {
    pricingDefaultsRef.current = pricingDefaults;
  }, [pricingDefaults]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab("pricing");
    setError(null);
    setIncludeAdditionalProfit(false);
    setForm(
      buildFormState({
        variant,
        defaultBuyPrice,
        defaultQuantity,
        defaultImages,
        defaultSku,
        isProductOnHold,
        pricingDefaults: pricingDefaultsRef.current,
      })
    );
  }, [
    defaultBuyPrice,
    defaultImages,
    defaultQuantity,
    defaultSku,
    isOpen,
    isProductOnHold,
    variant,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/supplier-settings", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          ebayFeePercent?: number;
          fixedFeeAmount?: number;
          additionalProfitPercent?: number;
          additionalProfitFixed?: number;
          minimumProfit?: number;
          applyAdditionalProfitToExisting?: boolean;
        };

        if (cancelled) {
          return;
        }

        const nextDefaults: SupplierPricingDefaults = {
          feesPercent: toFiniteNumber(data.ebayFeePercent),
          feesFixed: toFiniteNumber(data.fixedFeeAmount),
          profitPercent: toFiniteNumber(data.additionalProfitPercent),
          profitFixed: toFiniteNumber(data.additionalProfitFixed),
          minimumProfit: toFiniteNumber(data.minimumProfit),
          applyAdditionalProfitToExisting: Boolean(
            data.applyAdditionalProfitToExisting
          ),
        };

        pricingDefaultsRef.current = nextDefaults;
        setPricingDefaults(nextDefaults);

        setForm((prev) => {
          // When creating a new variant (variant === null), apply supplier defaults
          // if fee/profit fields are zero.
          if (!variant) {
            const allFeesZero =
              toNumber(prev.feesPercent) === 0 &&
              toNumber(prev.feesFixed) === 0 &&
              toNumber(prev.profitPercent) === 0 &&
              toNumber(prev.profitFixed) === 0;

            if (!allFeesZero) {
              return prev;
            }

            return recalculateSellPriceForState({
              ...prev,
              feesPercent: String(nextDefaults.feesPercent),
              feesFixed: String(nextDefaults.feesFixed),
              profitPercent: String(nextDefaults.profitPercent),
              profitFixed: String(nextDefaults.profitFixed),
              minimumProfit: String(nextDefaults.minimumProfit),
            });
          }

          // For existing variants, only add supplier additional profit once if the
          // settings toggle is enabled.
          if (nextDefaults.applyAdditionalProfitToExisting) {
            setIncludeAdditionalProfit(true);
            const currentFixed = toNumber(prev.profitFixed);
            const currentPercent = toNumber(prev.profitPercent);
            const nextFixed = currentFixed + nextDefaults.profitFixed;
            const nextPercent = currentPercent + nextDefaults.profitPercent;

            return recalculateSellPriceForState({
              ...prev,
              profitFixed: toMoneyString(nextFixed),
              profitPercent: String(nextPercent),
              minimumProfit: String(nextDefaults.minimumProfit),
            });
          }

          return prev;
        });
      } catch {
        // Leave zeroed pricing defaults in place if settings are unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, variant]);

  const imageUrls = useMemo(() => parseImages(form.imagesText), [form.imagesText]);
  const heroImage = imageUrls[0] || defaultImages[0] || "";
  const roundCents = form.roundCentsEnabled ? 0.99 : null;

  const sellPriceNumber = toNumber(form.sellPrice);
  const buyPriceNumber = toNumber(form.buyPrice);
  const totalFees = calculateTotalFees({
    sellPrice: sellPriceNumber,
    feesPercent: toNumber(form.feesPercent),
    feesFixed: toNumber(form.feesFixed),
  });
  const totalProfit = calculateNetProfit({
    buyPrice: buyPriceNumber,
    sellPrice: sellPriceNumber,
    feesPercent: toNumber(form.feesPercent),
    feesFixed: toNumber(form.feesFixed),
  });
  const isNegativeTotalProfit = totalProfit < 0;
  const desiredQuantity = Math.max(0, Math.floor(toNumber(form.quantity)));
  const willResumeOnSave = isProductOnHold && desiredQuantity > 0;

  function recalculateSellPrice(next: VariantFormState) {
    return recalculateSellPriceForState(next);
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
      const sellPrice = toNumber(value);
      const profitFixed = calculateProfitFixedFromSellPrice({
        buyPrice: toNumber(prev.buyPrice),
        sellPrice,
        feesPercent: toNumber(prev.feesPercent),
        feesFixed: toNumber(prev.feesFixed),
        profitPercent: toNumber(prev.profitPercent),
      });

      return {
        ...prev,
        sellPrice: value,
        profitFixed: toMoneyString(profitFixed),
      };
    });
  }

  function handleSellPriceBlur() {
    setForm((prev) => {
      const normalizedSellPrice = toMoneyString(
        applyRoundCents(toNumber(prev.sellPrice), prev.roundCentsEnabled ? 0.99 : null)
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

  function handleToggleAdditionalProfit(checked: boolean) {
    const defaults = pricingDefaultsRef.current ?? pricingDefaults ?? {
      feesPercent: 13,
      feesFixed: 0.33,
      profitPercent: 0,
      profitFixed: 14,
      minimumProfit: 1,
    };

    setIncludeAdditionalProfit(checked);
    setForm((prev) => {
      const addFixed = defaults.profitFixed || 0;
      const addPercent = defaults.profitPercent || 0;
      const currentFixed = toNumber(prev.profitFixed);
      const currentPercent = toNumber(prev.profitPercent);

      const nextFixed = checked
        ? currentFixed + addFixed
        : Math.max(0, currentFixed - addFixed);
      const nextPercent = checked
        ? currentPercent + addPercent
        : Math.max(0, currentPercent - addPercent);

      return recalculateSellPriceForState({
        ...prev,
        profitFixed: toMoneyString(nextFixed),
        profitPercent: String(nextPercent),
      });
    });
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

    const normalizedQuantity = Math.max(0, Math.floor(toNumber(form.quantity)));
    const storedQuantity = getStoredQuantityAfterEdit(
      isProductOnHold ? "ON_HOLD" : "IMPORTED",
      normalizedQuantity,
      variant?.quantity ?? defaultQuantity,
    );
    const payload: VariantPayload = {
      sku: form.sku.trim() || null,
      title: form.title.trim(),
      images: dedupeProductImages(imageUrls),
      buyPrice: toNumber(form.buyPrice),
      feesPercent: toNumber(form.feesPercent),
      feesFixed: toNumber(form.feesFixed),
      profitPercent: toNumber(form.profitPercent),
      profitFixed: toNumber(form.profitFixed),
      promotedAdPercent: Math.min(100, Math.max(0, toNumber(form.promotedAdPercent))),
      sellPrice: toNumber(form.sellPrice),
      quantity: storedQuantity,
      status:
        isProductOnHold && normalizedQuantity > 0 ? "IN_STOCK" : form.status,
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

      let optimisticProductStatus: string | undefined =
        typeof data.productStatus === "string" ? data.productStatus : undefined;

      if (normalizedQuantity > 0) {
        optimisticProductStatus = "IMPORTED";
        const resumeResponse = await fetch("/api/products/bulk-resume", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productIds: [productId] }),
        });
        const resumeData = (await resumeResponse.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!resumeResponse.ok) {
          setError(
            `Quantity was saved, but the listing could not be queued to resume on eBay: ${
              resumeData.error || "Unknown resume error"
            }`
          );
          return;
        }
      } else if (normalizedQuantity === 0) {
        optimisticProductStatus = "ON_HOLD";
        const holdResponse = await fetch("/api/products/bulk-hold", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ productIds: [productId] }),
        });
        const holdData = (await holdResponse.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!holdResponse.ok) {
          setError(
            `Quantity was saved, but the listing could not be queued to hold on eBay: ${
              holdData.error || "Unknown hold error"
            }`
          );
          return;
        }
      }

      onSaved(
        data as VariantRecord,
        variant ? "edit" : "create",
        optimisticProductStatus
      );
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

              <div
                className={`rounded-xl border px-4 py-3 text-right ${
                  isNegativeTotalProfit
                    ? "border-red-200 bg-red-50"
                    : "border-emerald-200 bg-emerald-50"
                }`}
              >
                <p
                  className={`text-xs font-medium uppercase tracking-wide ${
                    isNegativeTotalProfit ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  Total Profit
                </p>
                <p
                  className={`text-xl font-semibold ${
                    isNegativeTotalProfit ? "text-red-800" : "text-emerald-900"
                  }`}
                >
                  ${totalProfit.toFixed(2)}
                </p>
                <p
                  className={`text-xs ${
                    isNegativeTotalProfit ? "text-red-700" : "text-emerald-800"
                  }`}
                >
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
                    onBlur={handleSellPriceBlur}
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

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Local Promoted Ad Reference %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.promotedAdPercent}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        promotedAdPercent: event.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Reference only. Live eBay ad rates are synced on Products.
                  </p>
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

                {variant && (
                  <div
                    onClick={() =>
                      handleToggleAdditionalProfit(!includeAdditionalProfit)
                    }
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50/50 px-4 py-3 md:col-span-2 cursor-pointer hover:bg-orange-50 transition-colors select-none"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        Include Additional Profit from Settings
                      </span>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {pricingDefaults &&
                        (pricingDefaults.profitFixed > 0 ||
                          pricingDefaults.profitPercent > 0)
                          ? `Adds +A$${pricingDefaults.profitFixed.toFixed(
                              2
                            )} and +${pricingDefaults.profitPercent}% on top of existing profit.`
                          : "Adds supplier additional profit (+A$14.00) to this variant."}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      id="include-additional-profit-toggle"
                      checked={includeAdditionalProfit}
                      onChange={(event) => {
                        event.stopPropagation();
                        handleToggleAdditionalProfit(event.target.checked);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-4">
                {isProductOnHold && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <p className="font-medium">This eBay listing is on hold. Current quantity is 0.</p>
                    <p className="mt-1 text-xs">
                      Set Quantity above 0 and save to queue the listing to resume on eBay.
                    </p>
                  </div>
                )}
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
                      step="1"
                      value={form.quantity}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, quantity: event.target.value }))
                      }
                      className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                        isProductOnHold
                          ? "border-amber-300 bg-white font-medium text-gray-900"
                          : "border-gray-300 text-gray-900"
                      }`}
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
                    {isProductOnHold ? (
                      <div
                        className={`flex h-[38px] items-center rounded-md border px-3 text-sm font-medium ${
                          willResumeOnSave
                            ? "border-green-200 bg-green-50 text-green-800"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {willResumeOnSave
                          ? `Will resume with quantity ${desiredQuantity}`
                          : "On Hold (eBay quantity 0)"}
                      </div>
                    ) : (
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
                    )}
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
                  {isSaving
                    ? willResumeOnSave
                      ? "Saving & Queuing..."
                      : "Saving..."
                    : willResumeOnSave
                      ? "Save & Resume"
                      : variant
                        ? "Save Variant"
                        : "Create Variant"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
