/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyRoundCents,
  calculateNetProfit,
  calculateProfitFixedFromSellPrice,
  calculateProfitPercentFromSellPrice,
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
  defaultUploadProfitPercent: number;
  defaultUploadProfitFixed: number;
  minimumProfit: number;
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
  const buyPrice = toNumber(next.buyPrice);
  const feesPercent = toNumber(next.feesPercent);
  const feesFixed = toNumber(next.feesFixed);
  const profitPercent = toNumber(next.profitPercent);
  const profitFixed = toNumber(next.profitFixed);
  const minimumProfit = toNumber(next.minimumProfit);

  const sellPrice = calculateSellPrice({
    buyPrice,
    feesPercent,
    feesFixed,
    profitPercent,
    profitFixed,
    roundCents: next.roundCentsEnabled ? 0.99 : null,
    minimumProfit,
  });

  const derivedProfitPercent = calculateProfitPercentFromSellPrice({
    buyPrice,
    sellPrice,
    feesPercent,
    feesFixed,
    profitFixed: 0,
  });

  return {
    ...next,
    sellPrice: toMoneyString(sellPrice),
    profitPercent: profitPercent > 0 ? String(profitPercent) : String(derivedProfitPercent),
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
    const buyPrice = toNumber(variant.buyPrice.toString());
    const sellPrice = toNumber(variant.sellPrice.toString());
    const feesPercent = Number(variant.feesPercent);
    const feesFixed = Number(variant.feesFixed);
    let profitPercent = Number(variant.profitPercent);

    if (profitPercent === 0 && sellPrice > 0 && buyPrice > 0) {
      profitPercent = calculateProfitPercentFromSellPrice({
        buyPrice,
        sellPrice,
        feesPercent,
        feesFixed,
        profitFixed: 0,
      });
    }

    return {
      sku: variant.sku || "",
      title: variant.title,
      imagesText: dedupeProductImages(variant.images).join("\n"),
      buyPrice: variant.buyPrice.toString(),
      feesPercent: String(variant.feesPercent),
      feesFixed: String(variant.feesFixed),
      profitPercent: String(profitPercent),
      profitFixed: String(variant.profitFixed),
      minimumProfit: String(pricingDefaults?.minimumProfit ?? 0),
      promotedAdPercent: String(variant.promotedAdPercent ?? 0),
      sellPrice: variant.sellPrice.toString(),
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

  const buyPrice = defaultBuyPrice;
  const feesPercent = pricingDefaults?.feesPercent ?? 0;
  const feesFixed = pricingDefaults?.feesFixed ?? 0;
  let profitPercent = pricingDefaults?.defaultUploadProfitPercent ?? 0;
  const profitFixed = pricingDefaults?.defaultUploadProfitFixed ?? 0;
  const minimumProfit = pricingDefaults?.minimumProfit ?? 0;

  const sellPrice = calculateSellPrice({
    buyPrice,
    feesPercent,
    feesFixed,
    profitPercent,
    profitFixed,
    roundCents: null,
    minimumProfit,
  });

  if (profitPercent === 0 && sellPrice > 0 && buyPrice > 0) {
    profitPercent = calculateProfitPercentFromSellPrice({
      buyPrice,
      sellPrice,
      feesPercent,
      feesFixed,
      profitFixed: 0,
    });
  }

  return {
    sku: defaultSku || "",
    title: "Default",
    imagesText: dedupeProductImages(defaultImages).join("\n"),
    buyPrice: toMoneyString(defaultBuyPrice),
    feesPercent: String(feesPercent),
    feesFixed: String(feesFixed),
    profitPercent: String(profitPercent),
    profitFixed: String(profitFixed),
    minimumProfit: String(minimumProfit),
    promotedAdPercent: "0",
    sellPrice: toMoneyString(sellPrice),
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
  };
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
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const [pricingDefaults, setPricingDefaults] =
    useState<SupplierPricingDefaults | null>(null);
  const pricingDefaultsRef = useRef<SupplierPricingDefaults | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    const dialog = modalRef.current;

    if (!isOpen || !dialog) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [isOpen, portalRoot]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    pricingDefaultsRef.current = pricingDefaults;
  }, [pricingDefaults]);

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
          defaultUploadProfitPercent?: number;
          defaultUploadProfitFixed?: number;
          minimumProfit?: number;
        };

        if (cancelled) {
          return;
        }

        const nextDefaults: SupplierPricingDefaults = {
          feesPercent: toFiniteNumber(data.ebayFeePercent),
          feesFixed: toFiniteNumber(data.fixedFeeAmount),
          defaultUploadProfitPercent: toFiniteNumber(
            data.defaultUploadProfitPercent
          ),
          defaultUploadProfitFixed: toFiniteNumber(data.defaultUploadProfitFixed),
          minimumProfit: toFiniteNumber(data.minimumProfit),
        };

        pricingDefaultsRef.current = nextDefaults;
        setPricingDefaults(nextDefaults);

        setForm((prev) => {
          if (!variant) {
            const allFeesZero =
              toNumber(prev.feesPercent) === 0 &&
              toNumber(prev.feesFixed) === 0 &&
              toNumber(prev.profitPercent) === 0 &&
              toNumber(prev.profitFixed) === 0;

            if (!allFeesZero) {
              return {
                ...prev,
                minimumProfit: String(nextDefaults.minimumProfit),
              };
            }

            return recalculateSellPriceForState({
              ...prev,
              feesPercent: String(nextDefaults.feesPercent),
              feesFixed: String(nextDefaults.feesFixed),
              profitPercent: String(nextDefaults.defaultUploadProfitPercent),
              profitFixed: String(nextDefaults.defaultUploadProfitFixed),
              minimumProfit: String(nextDefaults.minimumProfit),
            });
          }

          return {
            ...prev,
            minimumProfit: String(nextDefaults.minimumProfit),
          };
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
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      const buyPrice = toNumber(next.buyPrice);
      const feesPercent = toNumber(next.feesPercent);
      const feesFixed = toNumber(next.feesFixed);
      const minimumProfit = toNumber(next.minimumProfit);

      if (field === "profitPercent") {
        const profitPercent = toNumber(value);
        const sellPrice = calculateSellPrice({
          buyPrice,
          feesPercent,
          feesFixed,
          profitPercent,
          profitFixed: 0,
          roundCents: next.roundCentsEnabled ? 0.99 : null,
          minimumProfit,
        });
        const profitFixed = calculateProfitFixedFromSellPrice({
          buyPrice,
          sellPrice,
          feesPercent,
          feesFixed,
          profitPercent: 0,
        });
        return {
          ...next,
          profitPercent: value,
          profitFixed: toMoneyString(profitFixed),
          sellPrice: toMoneyString(sellPrice),
        };
      }

      if (field === "profitFixed") {
        const profitFixed = toNumber(value);
        const sellPrice = calculateSellPrice({
          buyPrice,
          feesPercent,
          feesFixed,
          profitPercent: 0,
          profitFixed,
          roundCents: next.roundCentsEnabled ? 0.99 : null,
          minimumProfit,
        });
        const profitPercent = calculateProfitPercentFromSellPrice({
          buyPrice,
          sellPrice,
          feesPercent,
          feesFixed,
          profitFixed: 0,
        });
        return {
          ...next,
          profitFixed: value,
          profitPercent: String(profitPercent),
          sellPrice: toMoneyString(sellPrice),
        };
      }

      const sellPrice = calculateSellPrice({
        buyPrice,
        feesPercent,
        feesFixed,
        profitPercent: toNumber(next.profitPercent),
        profitFixed: toNumber(next.profitFixed),
        roundCents: next.roundCentsEnabled ? 0.99 : null,
        minimumProfit,
      });
      const profitPercent = calculateProfitPercentFromSellPrice({
        buyPrice,
        sellPrice,
        feesPercent,
        feesFixed,
        profitFixed: 0,
      });
      return {
        ...next,
        profitPercent: String(profitPercent),
        sellPrice: toMoneyString(sellPrice),
      };
    });
  }

  function handleSellPriceChange(value: string) {
    setForm((prev) => {
      const sellPrice = toNumber(value);
      const buyPrice = toNumber(prev.buyPrice);
      const feesPercent = toNumber(prev.feesPercent);
      const feesFixed = toNumber(prev.feesFixed);

      const profitFixed = calculateProfitFixedFromSellPrice({
        buyPrice,
        sellPrice,
        feesPercent,
        feesFixed,
        profitPercent: 0,
      });

      const profitPercent = calculateProfitPercentFromSellPrice({
        buyPrice,
        sellPrice,
        feesPercent,
        feesFixed,
        profitFixed: 0,
      });

      return {
        ...prev,
        sellPrice: value,
        profitFixed: toMoneyString(profitFixed),
        profitPercent: String(profitPercent),
      };
    });
  }

  function handleSellPriceBlur() {
    setForm((prev) => {
      const buyPrice = toNumber(prev.buyPrice);
      const feesPercent = toNumber(prev.feesPercent);
      const feesFixed = toNumber(prev.feesFixed);
      const minimumProfit = toNumber(prev.minimumProfit);
      const roundCents = prev.roundCentsEnabled ? 0.99 : null;

      let normalizedSellPriceNumber = applyRoundCents(
        toNumber(prev.sellPrice),
        roundCents
      );

      let netProfit = calculateNetProfit({
        buyPrice,
        sellPrice: normalizedSellPriceNumber,
        feesPercent,
        feesFixed,
      });

      if (minimumProfit > 0 && netProfit < minimumProfit) {
        normalizedSellPriceNumber = calculateSellPrice({
          buyPrice,
          feesPercent,
          feesFixed,
          profitPercent: 0,
          profitFixed: minimumProfit,
          roundCents,
          minimumProfit,
        });

        netProfit = calculateNetProfit({
          buyPrice,
          sellPrice: normalizedSellPriceNumber,
          feesPercent,
          feesFixed,
        });
      }

      const profitFixed = calculateProfitFixedFromSellPrice({
        buyPrice,
        sellPrice: normalizedSellPriceNumber,
        feesPercent,
        feesFixed,
        profitPercent: 0,
      });

      const profitPercent = calculateProfitPercentFromSellPrice({
        buyPrice,
        sellPrice: normalizedSellPriceNumber,
        feesPercent,
        feesFixed,
        profitFixed: 0,
      });

      return {
        ...prev,
        sellPrice: toMoneyString(normalizedSellPriceNumber),
        profitFixed: toMoneyString(profitFixed),
        profitPercent: String(profitPercent),
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

  if (!isOpen || !portalRoot) {
    return null;
  }

  return createPortal(
    <dialog
      ref={modalRef}
      aria-label={variant ? "Edit variant" : "Add variant"}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black/45 p-2 backdrop:bg-transparent open:flex open:items-end open:justify-center sm:p-4 sm:open:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-4xl max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
      >
        <div className="border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5 flex-shrink-0">
          <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              {heroImage ? (
                <img
                  src={heroImage}
                  alt={form.title || productTitle}
                  className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl object-cover border border-gray-200"
                />
              ) : (
                <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl border border-gray-200 bg-gray-100" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {variant ? "Edit Variant" : "Add Variant"}
                </p>
                <h2 className="truncate text-base sm:text-lg font-semibold text-gray-900">
                  {productTitle}
                </h2>
                <p className="truncate text-xs sm:text-sm text-gray-500">
                  {form.title.trim() || "Untitled variant"}
                </p>
              </div>
            </div>

            <div
              className={`rounded-xl border px-3 sm:px-4 py-2 sm:py-3 text-right flex-shrink-0 ${
                isNegativeTotalProfit
                  ? "border-red-200 bg-red-50"
                  : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <p
                className={`text-[11px] sm:text-xs font-medium uppercase tracking-wide ${
                  isNegativeTotalProfit ? "text-red-700" : "text-emerald-700"
                }`}
              >
                Total Profit
              </p>
              <p
                className={`text-lg sm:text-xl font-semibold ${
                  isNegativeTotalProfit ? "text-red-800" : "text-emerald-900"
                }`}
              >
                ${totalProfit.toFixed(2)}
              </p>
              <p
                className={`text-[11px] sm:text-xs ${
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

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
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
    </dialog>,
    portalRoot,
  );
}
