"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SlideOver from "@/components/SlideOver";
import RichTextEditor from "@/components/RichTextEditor";
import type { ScrapedProduct } from "@/components/AddProductModal";
import { reportClientError } from "@/lib/client-logger";

interface Store {
  id: string;
  name: string;
}

interface PolicyEntry {
  profileId: string;
  profileName: string;
}

interface Policies {
  shipping: PolicyEntry[];
  returns: PolicyEntry[];
  payment: PolicyEntry[];
}

interface DraftEditFormProps {
  isOpen: boolean;
  scrapedData: ScrapedProduct;
  onSuccess: () => void;
  onError: (message: string) => void;
  onClose: () => void;
}

const storeBadgeColors: Record<string, string> = {
  "Store 1": "bg-blue-100 text-blue-800",
  "Store 2": "bg-purple-100 text-purple-800",
  "Store 3": "bg-orange-100 text-orange-800",
};

const tabs = ["Product", "Description", "Images", "Item Specifications"];

export default function DraftEditForm({
  isOpen,
  scrapedData,
  onSuccess,
  onError,
  onClose,
}: DraftEditFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);

  // Store
  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeId, setStoreId] = useState("");

  // Policies
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [shippingPolicyId, setShippingPolicyId] = useState("");
  const [returnPolicyId, setReturnPolicyId] = useState("");
  const [paymentPolicyId, setPaymentPolicyId] = useState("");

  // Product fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [condition, setCondition] = useState("New");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [brand, setBrand] = useState("");
  const [variant, setVariant] = useState("");

  // Category suggestions
  const [catSuggestions, setCatSuggestions] = useState<Array<{ categoryId: string; categoryName: string }>>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [showCatDropdown, setShowCatDropdown] = useState(false);

  // Description
  const [description, setDescription] = useState("");
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string; isDefault: boolean }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Images
  const [images, setImages] = useState<string[]>([]);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);

  // Item specifics
  const [itemSpecifics, setItemSpecifics] = useState<
    { key: string; value: string }[]
  >([]);

  // Fetch templates on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        setTemplates(data);
        const defaultTemplate = data.find((t: { isDefault: boolean }) => t.isDefault);
        if (defaultTemplate) setSelectedTemplateId(defaultTemplate.id);
      })
      .catch(() => {});
  }, []);

  // Form state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-fill from scraped data
  useEffect(() => {
    if (scrapedData) {
      const defaults = scrapedData.supplierDefaults;

      // Apply title — capitalize if supplier setting is enabled
      let scrapedTitle = scrapedData.title;
      if (defaults?.capitalizeTitle) {
        scrapedTitle = scrapedTitle
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
      }
      setTitle(scrapedTitle);

      setCategory(scrapedData.categoryId || "");
      setCategoryName(scrapedData.categoryName || scrapedData.category || "");
      setCondition(scrapedData.condition);
      setPrice("");
      setQuantity(String(defaults?.quantity ?? 1));
      setBrand(scrapedData.brand);
      setVariant(scrapedData.variantName || "");
      setDescription(scrapedData.description);
      setImages([...scrapedData.images]);
      setHoveredImage(null);
      setItemSpecifics(
        Object.entries(scrapedData.itemSpecifics).map(([key, value]) => ({
          key,
          value,
        }))
      );
      setActiveTab(0);
      setErrors({});

      // Pre-fill policies from supplier defaults
      if (defaults?.shippingPolicyId) setShippingPolicyId(defaults.shippingPolicyId);
      if (defaults?.paymentPolicyId) setPaymentPolicyId(defaults.paymentPolicyId);
      if (defaults?.returnPolicyId) setReturnPolicyId(defaults.returnPolicyId);

      // Pre-select template from supplier defaults
      if (defaults?.templateId) setSelectedTemplateId(defaults.templateId);
    }
  }, [scrapedData]);

  // Fetch stores on mount
  useEffect(() => {
    async function fetchStores() {
      try {
        const res = await fetch("/api/stores");
        if (res.ok) {
          const data = await res.json();
          setStores(data);
        } else {
          void reportClientError(
            "draft-edit/stores",
            "Failed to fetch stores",
            undefined,
            { status: res.status },
            {
              requestId: res.headers.get("x-request-id") ?? undefined,
              tags: ["bootstrap"],
            },
          );
        }
      } catch (error) {
        void reportClientError(
          "draft-edit/stores",
          "Failed to fetch stores",
          error,
          undefined,
          { tags: ["bootstrap"] },
        );
      } finally {
        setStoresLoading(false);
      }
    }
    fetchStores();
  }, []);

  // Fetch policies when store changes
  useEffect(() => {
    if (!storeId) {
      setPolicies(null);
      setShippingPolicyId("");
      setReturnPolicyId("");
      setPaymentPolicyId("");
      return;
    }

    async function fetchPolicies() {
      setPoliciesLoading(true);
      try {
        const res = await fetch(`/api/policies?store=${storeId}`);
        if (res.ok) {
          const data = await res.json();
          setPolicies(data);
          // Auto-select first option if only one exists
          if (data.shipping.length === 1) setShippingPolicyId(data.shipping[0].profileId);
          if (data.returns.length === 1) setReturnPolicyId(data.returns[0].profileId);
          if (data.payment.length === 1) setPaymentPolicyId(data.payment[0].profileId);
        } else {
          void reportClientError(
            "draft-edit/policies",
            "Failed to fetch policies",
            undefined,
            { status: res.status, storeId },
            {
              requestId: res.headers.get("x-request-id") ?? undefined,
              tags: ["policies"],
            },
          );
          setPolicies(null);
        }
      } catch (error) {
        void reportClientError(
          "draft-edit/policies",
          "Failed to fetch policies",
          error,
          { storeId },
          { tags: ["policies"] },
        );
        setPolicies(null);
      } finally {
        setPoliciesLoading(false);
      }
    }
    fetchPolicies();
  }, [storeId]);

  // Derived
  const isSaveDisabled =
    !storeId || !price || parseFloat(price) === 0 || isSubmitting;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!storeId) newErrors.storeId = "Please select a store";
    if (!price || parseFloat(price) <= 0)
      newErrors.price = "Please enter a selling price";
    if (title.length > 80)
      newErrors.title = "Title must be 80 characters or less";
    if (!category.trim() || !/^\d+$/.test(category.trim()))
      newErrors.category = "eBay requires a numeric Category ID (e.g. 171114)";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // Amazon keyword detection
  const descriptionContainsAmazon = useMemo(() => {
    const plainText = description.replace(/<[^>]*>/g, "");
    return /amazon/i.test(plainText);
  }, [description]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    // Block import if Amazon keyword is in description
    if (descriptionContainsAmazon) {
      onError("Import blocked — description contains the word 'Amazon'. Edit your description and remove all mentions before importing.");
      return;
    }

    setIsSubmitting(true);

    const specificsObj: Record<string, string> = {};
    itemSpecifics.forEach((spec) => {
      if (spec.key.trim() && spec.value.trim()) {
        specificsObj[spec.key.trim()] = spec.value.trim();
      }
    });

    const body = {
      title: title.trim().slice(0, 80),
      description,
      price: parseFloat(price),
      quantity: parseInt(quantity),
      condition,
      category: category.trim(),
      categoryName: categoryName.trim() || null,
      images,
      itemSpecifics: specificsObj,
      storeId,
      asin: scrapedData.asin || undefined,
      shippingPolicyId: shippingPolicyId || undefined,
      returnPolicyId: returnPolicyId || undefined,
      paymentPolicyId: paymentPolicyId || undefined,
      templateId: selectedTemplateId || undefined,
    };

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        // Show keyword removal info if applicable
        if (data.removedKeywords && data.removedKeywords.length > 0) {
          onError(`Keywords automatically removed: ${data.removedKeywords.join(", ")}. Check your title and description.`);
        }
        onSuccess();
        router.refresh();
      } else {
        const data = await res.json();
        onError(data.error || "Failed to save product");
      }
    } catch {
      onError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Item specifics handlers
  function addSpecific() {
    setItemSpecifics([...itemSpecifics, { key: "", value: "" }]);
  }

  function removeSpecific(index: number) {
    setItemSpecifics(itemSpecifics.filter((_, i) => i !== index));
  }

  function updateSpecific(index: number, field: "key" | "value", val: string) {
    const updated = [...itemSpecifics];
    updated[index][field] = val;
    setItemSpecifics(updated);
  }

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title="Edit Draft">
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {/* Tabs */}
        <div className="border-b border-gray-200 px-6">
          <nav className="flex gap-6">
            {tabs.map((tab, i) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(i)}
                className={`py-3 text-sm transition-colors ${
                  activeTab === i
                    ? "border-b-2 border-orange-500 text-orange-600 font-medium"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ===================== Tab 1 — Product ===================== */}
          {activeTab === 0 && (
            <div className="space-y-4">
              {/* Store */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store
                </label>
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">
                    {storesLoading ? "Loading stores…" : "Select a store"}
                  </option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                {storeId && stores.find((s) => s.id === storeId) && (
                  <span
                    className={`inline-flex items-center mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      storeBadgeColors[
                        stores.find((s) => s.id === storeId)?.name || ""
                      ] || "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {stores.find((s) => s.id === storeId)?.name}
                  </span>
                )}
                {errors.storeId && (
                  <p className="mt-1 text-sm text-red-600">{errors.storeId}</p>
                )}
              </div>

              {/* Policies */}
              {storeId && (
                <div className="space-y-3">
                  {policiesLoading ? (
                    <p className="text-sm text-gray-500 animate-pulse">Loading policies…</p>
                  ) : policies ? (
                    <>
                      {/* Shipping Policy */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Shipping Policy
                        </label>
                        <select
                          value={shippingPolicyId}
                          onChange={(e) => setShippingPolicyId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="">Select shipping policy</option>
                          {policies.shipping.map((p) => (
                            <option key={p.profileId} value={p.profileId}>
                              {p.profileName}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Return Policy */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Return Policy
                        </label>
                        <select
                          value={returnPolicyId}
                          onChange={(e) => setReturnPolicyId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="">Select return policy</option>
                          {policies.returns.map((p) => (
                            <option key={p.profileId} value={p.profileId}>
                              {p.profileName}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Payment Policy */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Payment Policy
                        </label>
                        <select
                          value={paymentPolicyId}
                          onChange={(e) => setPaymentPolicyId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="">Select payment policy</option>
                          {policies.payment.map((p) => (
                            <option key={p.profileId} value={p.profileId}>
                              {p.profileName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <p
                  className={`mt-1 text-xs ${
                    title.length > 80 ? "text-red-600 font-medium" : "text-gray-400"
                  }`}
                >
                  {title.length}/80
                </p>
                {errors.title && (
                  <p className="mt-1 text-sm text-red-600">{errors.title}</p>
                )}
              </div>

              {/* Category — split into Name + ID */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category Name</label>
                  <input
                    type="text"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. Charging Equipment"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">eBay Category ID</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="e.g. 171114"
                    />
                    <button
                      type="button"
                      disabled={catLoading || !title.trim()}
                      onClick={async () => {
                        setCatLoading(true);
                        setShowCatDropdown(false);
                        try {
                          const selectedStore = stores.find((s) => s.id === storeId);
                          const storeNum = selectedStore?.name === "Store 2" ? 2 : selectedStore?.name === "Store 3" ? 3 : 1;
                          const res = await fetch("/api/suggest-category", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ title: title.trim(), storeNumber: storeNum }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setCatSuggestions(data);
                            setShowCatDropdown(true);
                          }
                        } catch { /* silent */ }
                        finally { setCatLoading(false); }
                      }}
                      className="px-3 py-2 border border-orange-500 text-orange-600 text-sm font-medium rounded-md hover:bg-orange-50 disabled:opacity-40 transition-colors whitespace-nowrap"
                    >
                      {catLoading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      ) : "Re-suggest"}
                    </button>
                  </div>
                </div>
              </div>
              {/* Suggestion Dropdown */}
              {showCatDropdown && (
                <div className="mt-1 bg-white border border-gray-200 rounded-md shadow-sm divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {catSuggestions.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-500">No suggestions found — please enter the ID manually</p>
                  ) : (
                    catSuggestions.map((s) => (
                      <button
                        key={s.categoryId}
                        type="button"
                        onClick={() => {
                          setCategory(s.categoryId);
                          setCategoryName(s.categoryName);
                          setShowCatDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                      >
                        {s.categoryName} <span className="text-gray-400">({s.categoryId})</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Not sure of the ID? Use the Re-suggest button or find it at{" "}
                <a href="https://www.ebay.com.au/sch/categories" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">ebay.com.au/sch/categories</a>
              </p>
              {errors.category && (
                <p className="mt-1 text-xs text-red-600">{errors.category}</p>
              )}

              {/* Condition */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition
                </label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="New">New</option>
                  <option value="Used">Used</option>
                </select>
              </div>

              {/* Price */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price (AUD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="0.00"
                  />
                </div>
                {errors.price && (
                  <p className="mt-1 text-sm text-red-600">{errors.price}</p>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Brand */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Brand
                </label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Variant */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Variant / Size Name
                </label>
                <input
                  type="text"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. 6m, Large, Black"
                />
              </div>
            </div>
          )}

          {/* ===================== Tab 2 — Description ===================== */}
          {activeTab === 1 && (
            <div>
              {descriptionContainsAmazon && (
                <div className="mb-3 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-md">
                  <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-red-700">
                    <strong>Warning:</strong> Your description contains the word &ldquo;Amazon&rdquo;. eBay may remove your listing for referencing a competitor. Remove all mentions of Amazon before importing.
                  </p>
                </div>
              )}
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              {/* Template selector */}
              <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
                <span className="text-sm text-gray-500">Selected Template:</span>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">— None —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
                <span className="text-gray-300">|</span>
                <Link href="/settings" className="text-orange-500 hover:text-orange-600 text-sm hover:underline">
                  Edit Templates
                </Link>
              </div>
              <div className="min-h-64">
                <RichTextEditor value={description} onChange={setDescription} minHeight="256px" toolbarVariant="compact" />
              </div>
            </div>
          )}

          {/* ===================== Tab 3 — Images ===================== */}
          {activeTab === 2 && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {images.map((url, i) => {
                  const isMain = i === 0;
                  const isHovered = hoveredImage === i;

                  return (
                    <div
                      key={i}
                      className="relative"
                      onMouseEnter={() => setHoveredImage(i)}
                      onMouseLeave={() => setHoveredImage(null)}
                    >
                      <img
                        src={url}
                        alt={`Product image ${i + 1}`}
                        title={url}
                        className="w-full aspect-square object-cover rounded border-2 border-orange-400"
                      />

                      {/* Hover overlay with buttons */}
                      {isHovered && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-20 rounded">
                          {!isMain && (
                            <button
                              type="button"
                              onClick={() => {
                                setImages((prev) => {
                                  const filtered = prev.filter((u) => u !== url);
                                  return [url, ...filtered];
                                });
                                setHoveredImage(0);
                              }}
                              className="border border-white text-white text-xs px-3 py-1.5 rounded hover:bg-white hover:text-black transition-colors w-36 text-center"
                            >
                              Set as Main Image
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setImages((prev) => prev.filter((u) => u !== url));
                              setHoveredImage(null);
                            }}
                            className="border border-white text-white text-xs px-3 py-1.5 rounded hover:bg-white hover:text-black transition-colors w-36 text-center"
                          >
                            Remove
                          </button>
                        </div>
                      )}

                      {/* Main image label */}
                      {isMain && (
                        <div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-white text-xs text-center py-1 rounded-b">
                          Main image
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {images.length === 0 ? (
                <p className="mt-4 text-sm text-red-600">
                  Add at least 1 image before saving
                </p>
              ) : (
                <p className="mt-4 text-sm text-gray-500">
                  {images.length} images will be imported to eBay
                </p>
              )}
            </div>
          )}

          {/* ===================== Tab 4 — Item Specifications ===================== */}
          {activeTab === 3 && (
            <div>
              {/* Table header */}
              <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <span className="flex-1">Name</span>
                <span className="flex-1">Value</span>
                <span className="w-10" />
              </div>

              {/* Rows */}
              <div className="divide-y divide-gray-100">
                {itemSpecifics.map((spec, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 px-3 py-2 ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50"
                    }`}
                  >
                    <input
                      type="text"
                      value={spec.key}
                      onChange={(e) =>
                        updateSpecific(index, "key", e.target.value)
                      }
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Name"
                    />
                    <input
                      type="text"
                      value={spec.value}
                      onChange={(e) =>
                        updateSpecific(index, "value", e.target.value)
                      }
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Value"
                    />
                    <button
                      type="button"
                      onClick={() => removeSpecific(index)}
                      className="w-10 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addSpecific}
                className="mt-3 text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
              >
                + Add Specification
              </button>
            </div>
          )}
        </div>

        {/* ===================== Footer ===================== */}
        <div className="border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left — title warning */}
            <div className="flex-1">
              {title.length > 80 && (
                <p className="text-sm text-red-600 font-medium">
                  Title too long — eBay maximum is 80 characters
                </p>
              )}
            </div>

            {/* Right — buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaveDisabled}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? "Saving…" : "Save as Draft"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </SlideOver>
  );
}
