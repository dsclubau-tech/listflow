"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import SlideOver from "@/components/SlideOver";
import type { ScrapedProduct } from "@/components/AddProductModal";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["link", "image"],
    [{ color: [] }, { background: [] }],
    ["clean"],
  ],
};

interface Store {
  id: string;
  name: string;
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

  // Product fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("New");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [brand, setBrand] = useState("");
  const [variant, setVariant] = useState("");

  // Description
  const [description, setDescription] = useState("");

  // Images
  const [images, setImages] = useState<string[]>([]);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);

  // Item specifics
  const [itemSpecifics, setItemSpecifics] = useState<
    { key: string; value: string }[]
  >([]);

  // Form state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-fill from scraped data
  useEffect(() => {
    if (scrapedData) {
      setTitle(scrapedData.title);
      setCategory(scrapedData.category);
      setCondition(scrapedData.condition);
      setPrice("");
      setQuantity("1");
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
        }
      } catch {
        console.error("Failed to fetch stores");
      } finally {
        setStoresLoading(false);
      }
    }
    fetchStores();
  }, []);

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
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

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
      images,
      itemSpecifics: specificsObj,
      storeId,
      asin: scrapedData.asin || undefined,
    };

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
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

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
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

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <div className="min-h-64">
                <ReactQuill
                  theme="snow"
                  value={description}
                  onChange={setDescription}
                  modules={quillModules}
                />
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
