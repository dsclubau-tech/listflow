"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Product, Store, User } from "@/app/generated/prisma/client";
import ProductVariantsEditor from "@/components/ProductVariantsEditor";
import RichTextEditor from "@/components/RichTextEditor";
import { reportClientError } from "@/lib/client-logger";

// ----- Types -----

type ProductWithRelations = Product & { store: Store; createdBy: User };

interface PolicyEntry {
  profileId: string;
  profileName: string;
}

interface Policies {
  shipping: PolicyEntry[];
  returns: PolicyEntry[];
  payment: PolicyEntry[];
}

interface InlineEditFormProps {
  product: ProductWithRelations;
  onCollapse: () => void;
}

// ----- VERO keywords -----

const VERO_KEYWORDS = [
  "Tesla", "Apple", "Samsung", "Sony", "Nike", "Adidas", "Dyson",
  "Philips", "Bosch", "LG", "Panasonic", "Canon", "Nikon", "Nintendo",
  "Microsoft", "Google", "Amazon", "Bose", "Beats", "GoPro",
];

function findVeroMatch(title: string): string | null {
  const lower = title.toLowerCase();
  for (const word of VERO_KEYWORDS) {
    if (lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

// ----- Store number helper -----

function storeNameToNumber(name: string): 1 | 2 | 3 {
  if (name === "Store 1") return 1;
  if (name === "Store 2") return 2;
  return 3;
}

// ----- Tabs -----

const tabs = ["Product", "Description", "Variants", "Images", "Item Specifications"];

// ===== Component =====

export default function InlineEditForm({ product }: InlineEditFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);

  // Policies
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  // Product tab fields
  const [title, setTitle] = useState(product.title);
  const [category, setCategory] = useState(product.category);
  const [categoryName, setCategoryName] = useState((product as Record<string, unknown>).categoryName as string || "");
  const [tags, setTags] = useState("");
  const [shippingMethods, setShippingMethods] = useState("Cheapest with tracking");

  // Category suggestions
  const [catSuggestions, setCatSuggestions] = useState<Array<{ categoryId: string; categoryName: string }>>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [paymentPolicyId, setPaymentPolicyId] = useState(product.paymentPolicyId || "");
  const [shippingPolicyId, setShippingPolicyId] = useState(product.shippingPolicyId || "");
  const [returnPolicyId, setReturnPolicyId] = useState(product.returnPolicyId || "");
  const [countryLocation, setCountryLocation] = useState("Australia");
  const [defaultZipcode, setDefaultZipcode] = useState("3170");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState(product.condition);
  const [price, setPrice] = useState(product.price.toString());
  const [quantity, setQuantity] = useState(product.quantity.toString());

  // Description
  const [description, setDescription] = useState(product.description);
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string; isDefault: boolean }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(product.templateId || "");

  // Images
  const [images, setImages] = useState<string[]>([...product.images]);
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);

  // Item Specifics
  const [itemSpecifics, setItemSpecifics] = useState<{ key: string; value: string }[]>([]);

  // Fetch templates on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        setTemplates(data);
        // If product has no templateId, select the default template
        if (!selectedTemplateId) {
          const defaultTemplate = data.find((t: { isDefault: boolean }) => t.isDefault);
          if (defaultTemplate) setSelectedTemplateId(defaultTemplate.id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; variant: "success" | "error" } | null>(null);

  // Parse brand / location from itemSpecifics on load
  useEffect(() => {
    const specs = product.itemSpecifics as Record<string, string> | null;
    if (specs && typeof specs === "object") {
      // Restore visible specs (exclude internal _-prefixed metadata)
      setItemSpecifics(
        Object.entries(specs)
          .filter(([key]) => !key.startsWith("_"))
          .map(([key, value]) => ({ key, value }))
      );
      if (specs["Brand"]) setBrand(specs["Brand"]);
      // Restore country location
      if (specs["_Location"]) setCountryLocation(specs["_Location"]);
      // Restore zipcode
      if (specs["_PostalCode"]) setDefaultZipcode(specs["_PostalCode"]);
    }
  }, [product.itemSpecifics]);

  // Fetch policies
  const fetchPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    try {
      const storeNum = storeNameToNumber(product.store.name);
      const res = await fetch(`/api/policies?store=${storeNum}`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      } else {
        void reportClientError(
          "inline-edit/policies",
          "Failed to fetch policies",
          undefined,
          { status: res.status, productId: product.id, storeNum },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["policies"],
          },
        );
      }
    } catch (error) {
      void reportClientError(
        "inline-edit/policies",
        "Failed to fetch policies",
        error,
        { productId: product.id },
        { tags: ["policies"] },
      );
    } finally {
      setPoliciesLoading(false);
    }
  }, [product.id, product.store.name]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  // Auto-clear save message
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const isImported = product.status === "IMPORTED" && Boolean(product.ebayItemId);

  // ----- Save -----

  async function handleSave(options?: { showSuccessMessage?: boolean }): Promise<boolean> {
    const { showSuccessMessage = true } = options ?? {};

    setIsSaving(true);
    setSaveMessage(null);

    // Validate category is numeric before saving
    if (!category.trim() || !/^\d+$/.test(category.trim())) {
      setSaveMessage({ variant: "error", text: "eBay requires a numeric Category ID (e.g. 171114). Please update the Category ID field." });
      setIsSaving(false);
      return false;
    }

    // Country → eBay codes
    const countryCodeMap: Record<string, string> = {
      Australia: "AU",
      "United States": "US",
      "United Kingdom": "GB",
    };
    const currencyMap: Record<string, string> = {
      Australia: "AUD",
      "United States": "USD",
      "United Kingdom": "GBP",
    };
    const siteMap: Record<string, string> = {
      Australia: "Australia",
      "United States": "US",
      "United Kingdom": "UK",
    };

    // Build visible itemSpecifics from the table rows
    const specificsObj: Record<string, string> = {};
    itemSpecifics.forEach((spec) => {
      if (spec.key.trim() && spec.value.trim()) {
        specificsObj[spec.key.trim()] = spec.value.trim();
      }
    });

    // Add Brand into specifics
    if (brand.trim()) specificsObj["Brand"] = brand.trim();

    // Embed internal location metadata with _ prefix so the XML builder can use it
    specificsObj["_Country"] = countryCodeMap[countryLocation] || "AU";
    specificsObj["_Currency"] = currencyMap[countryLocation] || "AUD";
    specificsObj["_Site"] = siteMap[countryLocation] || "Australia";
    specificsObj["_Location"] = countryLocation;
    specificsObj["_PostalCode"] = defaultZipcode.trim() || "3000";

    const body = {
      title: title.trim().slice(0, 80),
      description,
      price: parseFloat(price) || 0,
      quantity: parseInt(quantity) || 1,
      condition,
      category: category.trim(),
      categoryName: categoryName.trim() || null,
      images,
      itemSpecifics: specificsObj,
      shippingPolicyId: shippingPolicyId || null,
      returnPolicyId: returnPolicyId || null,
      paymentPolicyId: paymentPolicyId || null,
      templateId: selectedTemplateId || null,
    };

    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        // Show keyword removal toast if applicable
        if (data.removedKeywords && data.removedKeywords.length > 0) {
          setSaveMessage({
            text: `The following keywords were automatically removed: ${data.removedKeywords.join(", ")}. Check your title and description.`,
            variant: "error",
          });
        } else if (showSuccessMessage) {
          setSaveMessage({
            text: isImported ? "Saved locally. Update eBay to sync the live listing." : "Saved",
            variant: "success",
          });
        }
        router.refresh();
        return true;
      } else {
        const data = await res.json();
        void reportClientError(
          "inline-edit/save",
          "Product save failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["save"],
          },
        );
        setSaveMessage({ text: data.error || "Save failed", variant: "error" });
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      void reportClientError(
        "inline-edit/save",
        "Product save request failed",
        err,
        { productId: product.id },
        { tags: ["save"] },
      );
      setSaveMessage({ text: msg, variant: "error" });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  // Amazon keyword detection
  const descriptionContainsAmazon = useMemo(() => {
    const plainText = description.replace(/<[^>]*>/g, "");
    return /amazon/i.test(plainText);
  }, [description]);

  // ----- Save & Import -----

  async function handleSaveAndImport() {
    if (isImported) {
      setSaveMessage({
        variant: "error",
        text: "This product is already imported. Use Save & Update eBay instead.",
      });
      return;
    }

    // Block import if Amazon keyword is in description
    if (descriptionContainsAmazon) {
      setSaveMessage({
        variant: "error",
        text: "Import blocked - description contains the word 'Amazon'. Edit your description and remove all mentions before importing.",
      });
      return;
    }

    setIsImporting(true);
    setSaveMessage(null);

    const saved = await handleSave({ showSuccessMessage: false });
    if (!saved) {
      setIsImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      if (res.ok) {
        setSaveMessage({ text: "Imported", variant: "success" });
        router.refresh();
      } else {
        const data = await res.json();
        void reportClientError(
          "inline-edit/import",
          "Product import failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["import"],
          },
        );
        setSaveMessage({ text: data.error || "Import failed", variant: "error" });
      }
    } catch (err) {
      void reportClientError(
        "inline-edit/import",
        "Product import request failed",
        err,
        { productId: product.id },
        { tags: ["import"] },
      );
      setSaveMessage({ text: "Network error during import", variant: "error" });
    } finally {
      setIsImporting(false);
    }
  }

  // ----- Save & Update eBay -----
  const [isRevising, setIsRevising] = useState(false);

  async function handleSaveAndUpdateEbay() {
    if (!isImported) {
      setSaveMessage({
        variant: "error",
        text: "This product must be imported before it can be updated on eBay.",
      });
      return;
    }

    if (descriptionContainsAmazon) {
      setSaveMessage({
        variant: "error",
        text: "Update blocked - description contains the word 'Amazon'. Edit your description and remove all mentions before updating eBay.",
      });
      return;
    }

    setIsRevising(true);
    setSaveMessage(null);

    const saved = await handleSave({ showSuccessMessage: false });
    if (!saved) {
      setIsRevising(false);
      return;
    }

    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      if (res.ok) {
        setSaveMessage({ text: "eBay listing updated", variant: "success" });
        router.refresh();
      } else {
        const data = await res.json();
        void reportClientError(
          "inline-edit/revise",
          "Product revise failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["revise"],
          },
        );
        setSaveMessage({ text: data.error || "Update failed", variant: "error" });
      }
    } catch (err) {
      void reportClientError(
        "inline-edit/revise",
        "Product revise request failed",
        err,
        { productId: product.id },
        { tags: ["revise"] },
      );
      setSaveMessage({ text: "Network error during update", variant: "error" });
    } finally {
      setIsRevising(false);
    }
  }

  // ----- Item specifics -----

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

  // ----- VERO -----

  const veroMatch = findVeroMatch(title);

  // ----- Derived -----

  const storeBadge = product.store.name;
  const thumbnail = product.images[0] || "";

  return (
    <div className="bg-gray-50 border-t border-gray-200">
      {/* ===== Header bar ===== */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
        {/* Left side */}
        <div className="flex items-center gap-3 min-w-0">
          {thumbnail && (
            <img
              src={thumbnail}
              alt={product.title}
              className="w-10 h-10 rounded object-cover flex-shrink-0"
            />
          )}
          <span className="text-sm font-medium text-gray-900 truncate max-w-xs" title={product.title}>
            {product.title}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 flex-shrink-0">
            {storeBadge}
          </span>
          {product.asin && (
            <span className="text-xs text-gray-400 flex-shrink-0">
              Supplier: Amazon AU
            </span>
          )}
        </div>

        {/* Right side — buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveMessage && (
            <span
              className={`text-sm font-medium ${
                saveMessage.variant === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {saveMessage.text}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isImporting || isRevising}
            className="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {isSaving ? "Saving..." : isImported ? "Save Locally" : "Save"}
          </button>
          {!isImported && (
            <button
              type="button"
              onClick={handleSaveAndImport}
              disabled={isSaving || isImporting || isRevising}
              className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md disabled:opacity-40 transition-colors"
            >
              {isImporting ? "Importing..." : "Save & Import"}
            </button>
          )}
          {isImported && (
            <button
              type="button"
              onClick={handleSaveAndUpdateEbay}
              disabled={isSaving || isImporting || isRevising}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-md disabled:opacity-40 transition-colors"
            >
              {isRevising ? "Updating..." : "Save & Update eBay"}
            </button>
          )}
        </div>
      </div>

      {/* ===== VERO Warning ===== */}
      {veroMatch && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          Product title contains a VERO word, keyword ({veroMatch}).{" "}
          <a
            href="https://www.ebay.com.au/help/policies/listing-policies/vero-program"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium hover:text-red-900"
          >
            Read More
          </a>
        </div>
      )}

      {/* ===== Tabs ===== */}
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

      {/* ===== Tab Content ===== */}
      <div className="p-6 max-h-[600px] overflow-y-auto">
        {/* ===== Tab 1 — Product ===== */}
        {activeTab === 0 && (
          <div className="grid grid-cols-2 gap-4">
            {/* Title — full width */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className={`mt-1 text-xs ${title.length > 80 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                {title.length}/80
              </p>
            </div>

            {/* Category — split into Name + ID */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
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
                        const storeNum = storeNameToNumber(product.store.name);
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
              <div className="col-span-2 bg-white border border-gray-200 rounded-md shadow-sm divide-y divide-gray-100 max-h-48 overflow-y-auto">
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
            <p className="col-span-2 text-xs text-gray-400">
              Not sure of the ID? Use the Re-suggest button or find it at{" "}
              <a href="https://www.ebay.com.au/sch/categories" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">ebay.com.au/sch/categories</a>
            </p>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Enter Tag"
              />
            </div>

            {/* Shipping Methods */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Methods</label>
              <input
                type="text"
                value={shippingMethods}
                onChange={(e) => setShippingMethods(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Brand */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Payment Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={paymentPolicyId}
                  onChange={(e) => setPaymentPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select payment policy</option>
                  {policies?.payment.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Shipping Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={shippingPolicyId}
                  onChange={(e) => setShippingPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select shipping policy</option>
                  {policies?.shipping.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Return Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={returnPolicyId}
                  onChange={(e) => setReturnPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select return policy</option>
                  {policies?.returns.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Country Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country Location</label>
              <select
                value={countryLocation}
                onChange={(e) => setCountryLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="Australia">Australia</option>
                <option value="United States">United States</option>
                <option value="United Kingdom">United Kingdom</option>
              </select>
            </div>

            {/* Default Zipcode */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Zipcode</label>
              <input
                type="text"
                value={defaultZipcode}
                onChange={(e) => setDefaultZipcode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Condition */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Price (AUD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
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
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            </div>
        )}

        {/* ===== Tab 2 — Description ===== */}
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
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
            <div className="min-h-[300px]">
              <RichTextEditor value={description} onChange={setDescription} minHeight="300px" toolbarVariant="compact" />
            </div>
          </div>
        )}

        {/* ===== Tab 3 — Variants ===== */}
        {activeTab === 2 && (
          <>
            <ProductVariantsEditor
              product={{
                id: product.id,
                title: product.title,
                price: product.price.toString(),
                quantity: product.quantity,
                images: product.images,
                asin: product.asin,
              }}
            />
            <div className="hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2 text-left w-14">Image</th>
                  <th className="px-3 py-2 text-left">Variant</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Buy ID</th>
                  <th className="px-3 py-2 text-left w-32">Price</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-3 py-2">
                    {thumbnail ? (
                      <img src={thumbnail} alt="variant" className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-200 rounded" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {product.condition || "Default"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      IN STOCK
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">
                    {product.asin || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full pl-5 pr-2 py-1 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              className="mt-3 text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
            >
              + Add Variant
            </button>
            </div>
          </>
        )}

        {/* ===== Tab 4 — Images ===== */}
        {activeTab === 3 && (
          <div>
            <div className="grid grid-cols-7 gap-2">
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
                      className="w-full aspect-square object-cover rounded border border-gray-200"
                    />

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
                            className="border border-white text-white text-xs px-2 py-1 rounded hover:bg-white hover:text-black transition-colors text-center"
                          >
                            Set as Main
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setImages((prev) => prev.filter((u) => u !== url));
                            setHoveredImage(null);
                          }}
                          className="border border-white text-white text-xs px-2 py-1 rounded hover:bg-white hover:text-black transition-colors text-center"
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    {isMain && (
                      <div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-white text-xs text-center py-0.5 rounded-b">
                        Main image
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-gray-500">
              {images.length} images
            </p>
          </div>
        )}

        {/* ===== Tab 5 — Item Specifications ===== */}
        {activeTab === 4 && (
          <div>
            <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span className="flex-1">Name</span>
              <span className="flex-1">Value</span>
              <span className="w-10" />
            </div>

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
                    onChange={(e) => updateSpecific(index, "key", e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Name"
                  />
                  <input
                    type="text"
                    value={spec.value}
                    onChange={(e) => updateSpecific(index, "value", e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    onClick={() => removeSpecific(index)}
                    className="w-10 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
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
              className="mt-3 text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
            >
              + Add Item Specification
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
