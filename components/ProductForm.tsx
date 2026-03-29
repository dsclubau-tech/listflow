"use client";

import { useState, useEffect } from "react";
import { reportClientError } from "@/lib/client-logger";

interface Store {
  id: string;
  name: string;
}

interface ProductFormProps {
  onSuccess: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}

const storeBadgeColors: Record<string, string> = {
  "Store 1": "bg-blue-100 text-blue-800",
  "Store 2": "bg-purple-100 text-purple-800",
  "Store 3": "bg-orange-100 text-orange-800",
};

export default function ProductForm({
  onSuccess,
  onError,
  onCancel,
}: ProductFormProps) {
  // Store selection
  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeId, setStoreId] = useState("");

  // Product details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState("New");
  const [category, setCategory] = useState("");

  // Images
  const [images, setImages] = useState([""]);

  // Item specifics
  const [itemSpecifics, setItemSpecifics] = useState([
    { key: "", value: "" },
  ]);

  // Form state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
            "product-form/stores",
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
          "product-form/stores",
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

  // Validate form
  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!storeId) newErrors.storeId = "Please select a store";
    if (!title.trim()) newErrors.title = "Title is required";
    if (title.length > 80) newErrors.title = "Title must be 80 characters or less";
    if (!description.trim()) newErrors.description = "Description is required";
    if (!price || parseFloat(price) < 0) newErrors.price = "Valid price is required";
    if (!quantity || parseInt(quantity) < 1) newErrors.quantity = "Quantity must be at least 1";
    if (!category.trim()) newErrors.category = "Category is required";

    const validImages = images.filter((url) => url.trim() !== "");
    if (validImages.length === 0) newErrors.images = "At least one image URL is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // Handle submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validate()) return;

    setIsSubmitting(true);

    // Build item specifics as JSON object
    const specificsObj: Record<string, string> = {};
    itemSpecifics.forEach((spec) => {
      if (spec.key.trim() && spec.value.trim()) {
        specificsObj[spec.key.trim()] = spec.value.trim();
      }
    });

    const body = {
      title: title.trim().slice(0, 80),
      description: description.trim(),
      price: parseFloat(price),
      quantity: parseInt(quantity),
      condition,
      category: category.trim(),
      images: images.filter((url) => url.trim() !== ""),
      itemSpecifics: specificsObj,
      storeId,
    };

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSuccess();
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

  // Image handlers
  function addImageField() {
    setImages([...images, ""]);
  }

  function removeImageField(index: number) {
    setImages(images.filter((_, i) => i !== index));
  }

  function updateImage(index: number, value: string) {
    const updated = [...images];
    updated[index] = value;
    setImages(updated);
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
    <form onSubmit={handleSubmit} className="p-6 space-y-8">
      {/* Section 1 — Store assignment */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Assign to store
        </label>
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
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

      {/* Section 2 — Product details */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Product details</h3>

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
            placeholder="e.g. Sony WH-1000XM5 Wireless Headphones"
          />
          <p className="mt-1 text-xs text-gray-400">{title.length}/80</p>
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
            placeholder="Product description…"
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description}</p>
          )}
        </div>

        {/* Price & Quantity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Price
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                $
              </span>
              <input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
                placeholder="0.00"
              />
            </div>
            {errors.price && (
              <p className="mt-1 text-sm text-red-600">{errors.price}</p>
            )}
          </div>
          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
            />
            {errors.quantity && (
              <p className="mt-1 text-sm text-red-600">{errors.quantity}</p>
            )}
          </div>
        </div>

        {/* Condition */}
        <div>
          <label htmlFor="condition" className="block text-sm font-medium text-gray-700 mb-1">
            Condition
          </label>
          <select
            id="condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
          >
            <option value="New">New</option>
            <option value="Used">Used</option>
          </select>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
            Category
          </label>
          <input
            id="category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
            placeholder="e.g. Consumer Electronics"
          />
          {errors.category && (
            <p className="mt-1 text-sm text-red-600">{errors.category}</p>
          )}
        </div>
      </div>

      {/* Section 3 — Images */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          Images (minimum 1)
        </h3>
        <div className="space-y-3">
          {images.map((url, index) => (
            <div key={index} className="flex items-start gap-3">
              {/* Thumbnail preview */}
              {url.trim() && (
                <img
                  src={url}
                  alt={`Preview ${index + 1}`}
                  className="w-16 h-16 object-cover rounded border border-gray-200 flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <input
                type="url"
                value={url}
                onChange={(e) => updateImage(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
                placeholder="https://example.com/image.jpg"
              />
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => removeImageField(index)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addImageField}
          className="mt-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          + Add image URL
        </button>
        {errors.images && (
          <p className="mt-1 text-sm text-red-600">{errors.images}</p>
        )}
      </div>

      {/* Section 4 — Item specifics */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          Item specifics
        </h3>
        <div className="space-y-3">
          {itemSpecifics.map((spec, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="text"
                value={spec.key}
                onChange={(e) => updateSpecific(index, "key", e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
                placeholder="e.g. Brand"
              />
              <input
                type="text"
                value={spec.value}
                onChange={(e) => updateSpecific(index, "value", e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800"
                placeholder="e.g. Sony"
              />
              <button
                type="button"
                onClick={() => removeSpecific(index)}
                className="text-gray-400 hover:text-red-500 transition-colors p-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSpecific}
          className="mt-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          + Add specific
        </button>
      </div>

      {/* Footer buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? "Saving…" : "Save as Draft"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
