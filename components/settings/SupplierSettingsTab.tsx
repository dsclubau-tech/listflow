"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface SupplierSettingsData {
  id: string;
  supplierName: string;
  defaultQuantity: number;
  defaultCountry: string;
  defaultZipcode: string;
  defaultShippingMethod: string;
  defaultTemplateId: string | null;
  defaultShippingPolicyId: string | null;
  defaultPaymentPolicyId: string | null;
  defaultReturnPolicyId: string | null;
  ebayFeePercent: number;
  fixedFeeAmount: number;
  additionalProfitPercent: number;
  additionalProfitFixed: number;
  minimumProfit: number;
  capitalizeTitle: boolean;
  autofillBrand: boolean;
  allowVeroKeywords: boolean;
  privateListing: boolean;
  defaultWeightUnit: string;
  automaticSkuFilling: boolean;
  minProductQuantity: number;
  maxShippingDays: number;
  primeOnly: boolean;
  priceTrackingEnabled: boolean;
  priceCheckHour: number;
  scrapePostcode: string;
  storeNumber: number;
  defaultItemSpecifics: Record<string, string>;
}

interface Template {
  id: string;
  name: string;
  isDefault: boolean;
}

interface PolicyProfile {
  profileId: string;
  profileName: string;
}

interface Policies {
  shipping: PolicyProfile[];
  returns: PolicyProfile[];
  payment: PolicyProfile[];
}

const subTabs = ["Lister", "Pricing", "General"] as const;
type SubTab = (typeof subTabs)[number];

const countries = ["Australia", "United States", "United Kingdom", "Canada"];
const weightUnits = ["Kg", "Lb", "Oz", "G"];

function zipcodeLocationText(zip: string): string {
  const map: Record<string, string> = {
    "3170": "Mulgrave, VIC",
    "2000": "Sydney, NSW",
    "4000": "Brisbane, QLD",
    "5000": "Adelaide, SA",
    "6000": "Perth, WA",
    "7000": "Hobart, TAS",
  };
  return map[zip] || "";
}

export default function SupplierSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("Lister");

  // Settings state
  const [settings, setSettings] = useState<SupplierSettingsData | null>(null);

  // Sidebar
  const [selectedStore, setSelectedStore] = useState("1");

  // Templates & Policies
  const [templates, setTemplates] = useState<Template[]>([]);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  // Item specifics
  const [specName, setSpecName] = useState("");
  const [specValue, setSpecValue] = useState("");

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/supplier-settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setSelectedStore(String(data.storeNumber || 1));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) setTemplates(await res.json());
    } catch { /* ignore */ }
  }, []);

  // Fetch policies for selected store
  const fetchPolicies = useCallback(async (storeNum: string) => {
    setPoliciesLoading(true);
    try {
      const res = await fetch(`/api/policies?store=${storeNum}`);
      if (res.ok) {
        setPolicies(await res.json());
      } else {
        setPolicies(null);
      }
    } catch {
      setPolicies(null);
    } finally {
      setPoliciesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchTemplates();
  }, [fetchSettings, fetchTemplates]);

  useEffect(() => {
    fetchPolicies(selectedStore);
  }, [selectedStore, fetchPolicies]);

  // Update a single field
  function updateField<K extends keyof SupplierSettingsData>(field: K, value: SupplierSettingsData[K]) {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  // Item Specifics
  function addItemSpecific() {
    if (!specName.trim() || !specValue.trim() || !settings) return;
    const specs = { ...(settings.defaultItemSpecifics || {}), [specName.trim()]: specValue.trim() };
    updateField("defaultItemSpecifics", specs);
    setSpecName("");
    setSpecValue("");
  }

  function removeItemSpecific(key: string) {
    if (!settings) return;
    const specs = { ...settings.defaultItemSpecifics };
    delete specs[key];
    updateField("defaultItemSpecifics", specs);
  }

  // Save
  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/supplier-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultQuantity: settings.defaultQuantity,
          defaultCountry: settings.defaultCountry,
          defaultZipcode: settings.defaultZipcode,
          defaultShippingMethod: settings.defaultShippingMethod,
          defaultTemplateId: settings.defaultTemplateId,
          defaultShippingPolicyId: settings.defaultShippingPolicyId,
          defaultPaymentPolicyId: settings.defaultPaymentPolicyId,
          defaultReturnPolicyId: settings.defaultReturnPolicyId,
          ebayFeePercent: settings.ebayFeePercent,
          fixedFeeAmount: settings.fixedFeeAmount,
          additionalProfitPercent: settings.additionalProfitPercent,
          additionalProfitFixed: settings.additionalProfitFixed,
          minimumProfit: settings.minimumProfit,
          capitalizeTitle: settings.capitalizeTitle,
          autofillBrand: settings.autofillBrand,
          allowVeroKeywords: settings.allowVeroKeywords,
          privateListing: settings.privateListing,
          defaultWeightUnit: settings.defaultWeightUnit,
          automaticSkuFilling: settings.automaticSkuFilling,
          minProductQuantity: settings.minProductQuantity,
          maxShippingDays: settings.maxShippingDays,
          primeOnly: settings.primeOnly,
          priceTrackingEnabled: settings.priceTrackingEnabled,
          priceCheckHour: settings.priceCheckHour,
          scrapePostcode: settings.scrapePostcode,
          storeNumber: parseInt(selectedStore),
          defaultItemSpecifics: settings.defaultItemSpecifics,
        }),
      });

      if (res.ok) {
        setToast("Settings saved");
        setTimeout(() => setToast(null), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  // Pricing calculator
  const pricingCalc = useMemo(() => {
    if (!settings) return { fees: 0, fixedFee: 0, profit: 0, total: 0 };
    const cost = 100;
    const feePercent = settings.ebayFeePercent / 100;
    const profitPercent = settings.additionalProfitPercent / 100;
    const fees = cost * feePercent;
    const fixedFee = settings.fixedFeeAmount;
    const profitDollar = cost * profitPercent + settings.additionalProfitFixed;
    const total = cost + fees + fixedFee + profitDollar;
    return { fees: +fees.toFixed(2), fixedFee, profit: +profitDollar.toFixed(2), total: +total.toFixed(2) };
  }, [settings]);

  if (loading || !settings) {
    return <p className="text-sm text-gray-500">Loading supplier settings…</p>;
  }

  return (
    <div className="flex gap-6">
      {/* ===== LEFT SIDEBAR ===== */}
      <div className="w-56 flex-shrink-0">
        {/* Store selector */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Select Store
          </label>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="1">Store 1</option>
            <option value="2">Store 2</option>
            <option value="3">Store 3</option>
          </select>
        </div>

        {/* Supplier list */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Supplier
          </label>
          <div className="border border-orange-300 bg-orange-50 rounded-md px-3 py-2.5 flex items-center gap-2.5">
            {/* Amazon icon */}
            <div className="w-7 h-7 rounded-full bg-orange-400 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="text-sm font-medium text-gray-800">Amazon AU</span>
          </div>
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 min-w-0">
        {/* Sub-tab navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-5">
            {subTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveSubTab(tab)}
                className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeSubTab === tab
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* ==================== LISTER TAB ==================== */}
        {activeSubTab === "Lister" && (
          <div className="space-y-8">
            {/* Lister Settings */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Lister Settings</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Product Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.defaultQuantity}
                    onChange={(e) => updateField("defaultQuantity", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Item Country</label>
                  <select
                    value={settings.defaultCountry}
                    onChange={(e) => updateField("defaultCountry", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {countries.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Zipcode</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={settings.defaultZipcode}
                      onChange={(e) => updateField("defaultZipcode", e.target.value)}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    {zipcodeLocationText(settings.defaultZipcode) && (
                      <span className="text-xs text-gray-400">{zipcodeLocationText(settings.defaultZipcode)}</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Shipping Methods</label>
                  <input
                    type="text"
                    value={settings.defaultShippingMethod}
                    onChange={(e) => updateField("defaultShippingMethod", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Default Template</label>
                  <select
                    value={settings.defaultTemplateId || ""}
                    onChange={(e) => updateField("defaultTemplateId", e.target.value || null)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">— None —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.isDefault ? " (Default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Selling Platform Policies */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Selling Platform Policies</h3>
              {policiesLoading ? (
                <p className="text-xs text-gray-400">Loading policies for Store {selectedStore}…</p>
              ) : !policies ? (
                <p className="text-xs text-red-400">Could not load policies. Check store credentials.</p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Payment Policy</label>
                    <select
                      value={settings.defaultPaymentPolicyId || ""}
                      onChange={(e) => updateField("defaultPaymentPolicyId", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">— Select —</option>
                      {policies.payment.map((p) => (
                        <option key={p.profileId} value={p.profileId}>{p.profileName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Shipping Policy</label>
                    <select
                      value={settings.defaultShippingPolicyId || ""}
                      onChange={(e) => updateField("defaultShippingPolicyId", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">— Select —</option>
                      {policies.shipping.map((p) => (
                        <option key={p.profileId} value={p.profileId}>{p.profileName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Return Policy</label>
                    <select
                      value={settings.defaultReturnPolicyId || ""}
                      onChange={(e) => updateField("defaultReturnPolicyId", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">— Select —</option>
                      {policies.returns.map((p) => (
                        <option key={p.profileId} value={p.profileId}>{p.profileName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </section>

            {/* Advanced Lister Settings */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Advanced Lister Settings</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {/* Left column */}
                <div className="space-y-3">
                  <CheckRow label="Allow Duplicates" checked={false} disabled />
                  <CheckRow label="Upload Variations" checked={false} disabled />
                  <CheckRow label="Apply Watermark" checked={false} disabled />
                  <CheckRow label="Duplicate Main Image up to 12" checked={false} disabled />
                  <CheckRow label="Allow Marketplace Sellers" checked={false} disabled />
                  <CheckRow
                    label="Private Listing"
                    checked={settings.privateListing}
                    onChange={(v) => updateField("privateListing", v)}
                  />
                </div>
                {/* Right column */}
                <div className="space-y-3">
                  <CheckRow label="Allow OOS Variations" checked={true} disabled />
                  <CheckRow
                    label="Capitalize Title"
                    checked={settings.capitalizeTitle}
                    onChange={(v) => updateField("capitalizeTitle", v)}
                  />
                  <CheckRow
                    label="Autofill Brand"
                    checked={settings.autofillBrand}
                    onChange={(v) => updateField("autofillBrand", v)}
                  />
                  <CheckRow label="Split Variants into Products" checked={false} disabled />
                  <CheckRow
                    label="Allow Vero/Blocked Keywords"
                    checked={settings.allowVeroKeywords}
                    onChange={(v) => updateField("allowVeroKeywords", v)}
                  />
                </div>
              </div>
            </section>

            {/* Default Item Specifics */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Default Item Specifics</h3>
              <div className="flex items-end gap-3 mb-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={specName}
                    onChange={(e) => setSpecName(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. Brand"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <input
                    type="text"
                    value={specValue}
                    onChange={(e) => setSpecValue(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. Unbranded"
                  />
                </div>
                <button
                  type="button"
                  onClick={addItemSpecific}
                  disabled={!specName.trim() || !specValue.trim()}
                  className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {Object.keys(settings.defaultItemSpecifics || {}).length > 0 && (
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(settings.defaultItemSpecifics || {}).map(([k, v]) => (
                        <tr key={k} className="border-t hover:bg-gray-50">
                          <td className="px-3 py-2">{k}</td>
                          <td className="px-3 py-2">{v}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeItemSpecific(k)}
                              className="text-red-400 hover:text-red-600 transition-colors"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ==================== PRICING TAB ==================== */}
        {activeSubTab === "Pricing" && (
          <div className="space-y-8">
            {/* Profit Settings */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Profit Settings</h3>

              {/* Visual calculator bar */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200 mb-6 text-xs">
                <div className="bg-gray-100 px-4 py-3 flex-1">
                  <div className="font-medium text-gray-600">Product Cost</div>
                  <div className="text-gray-800 mt-0.5">A$100.00</div>
                </div>
                <div className="bg-green-50 px-4 py-3 flex-1 border-l border-gray-200">
                  <div className="font-medium text-green-700">Profits</div>
                  <div className="text-green-800 mt-0.5">A${pricingCalc.profit.toFixed(2)}</div>
                </div>
                <div className="bg-orange-50 px-4 py-3 flex-1 border-l border-gray-200">
                  <div className="font-medium text-orange-700">{settings.ebayFeePercent}% Fees</div>
                  <div className="text-orange-800 mt-0.5">A${pricingCalc.fees.toFixed(2)}</div>
                </div>
                <div className="bg-orange-50 px-4 py-3 flex-1 border-l border-gray-200">
                  <div className="font-medium text-orange-700">A$ Fee</div>
                  <div className="text-orange-800 mt-0.5">A${pricingCalc.fixedFee.toFixed(2)}</div>
                </div>
                <div className="bg-blue-50 px-4 py-3 flex-1 border-l border-gray-200">
                  <div className="font-medium text-blue-700">Total Price</div>
                  <div className="text-blue-800 font-semibold mt-0.5">A${pricingCalc.total.toFixed(2)}</div>
                </div>
              </div>

              {/* Fee/profit inputs */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Fees (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.ebayFeePercent}
                    onChange={(e) => updateField("ebayFeePercent", parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">A$ Fee Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.fixedFeeAmount}
                    onChange={(e) => updateField("fixedFeeAmount", parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Additional Profit (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.additionalProfitPercent}
                    onChange={(e) => updateField("additionalProfitPercent", parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Additional Profit (A$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.additionalProfitFixed}
                    onChange={(e) => updateField("additionalProfitFixed", parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Automation</label>
                  <select
                    disabled
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500"
                  >
                    <option>No automation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Minimum Profit per Product</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settings.minimumProfit}
                    onChange={(e) => updateField("minimumProfit", parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Dynamic profit toggle — UI only */}
              <div className="flex items-center gap-3 mb-6">
                <ToggleSwitch checked={false} disabled />
                <span className="text-sm text-gray-500">Dynamic profit</span>
              </div>
            </section>

            {/* Additional Pricing Settings */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Additional Pricing Settings</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ToggleSwitch checked={false} disabled />
                  <span className="text-sm text-gray-600">Set Price Cents Value</span>
                </div>
                <CheckRow label="Include shipping price" checked={true} disabled />
              </div>
            </section>
          </div>
        )}

        {/* ==================== GENERAL TAB ==================== */}
        {activeSubTab === "General" && (
          <div className="space-y-8">
            {/* General */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">General</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Weight Unit</label>
                  <select
                    value={settings.defaultWeightUnit}
                    onChange={(e) => updateField("defaultWeightUnit", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {weightUnits.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex items-center gap-3">
                    <ToggleSwitch
                      checked={settings.automaticSkuFilling}
                      onChange={(v) => updateField("automaticSkuFilling", v)}
                    />
                    <span className="text-sm text-gray-600">Automatic SKU Filling</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Monitoring */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Monitoring</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Minimum Product Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.minProductQuantity}
                    onChange={(e) => updateField("minProductQuantity", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Minimum stock quantity required to keep the product active</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Maximum Shipping Days</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.maxShippingDays}
                    onChange={(e) => updateField("maxShippingDays", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Choose from Suppliers Table</label>
                  <select
                    disabled
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500"
                  >
                    <option>Prime First</option>
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <CheckRow
                    label="Prime only"
                    checked={settings.primeOnly}
                    onChange={(v) => updateField("primeOnly", v)}
                  />
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Price Tracking</h3>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      Enable automatic Amazon to eBay price checks
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      When enabled, imported products with an ASIN and at least one
                      variant can be checked on a daily cron run. The configured
                      hour is in UTC and should match your Railway cron schedule.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.priceTrackingEnabled}
                    onChange={(value) => updateField("priceTrackingEnabled", value)}
                  />
                </div>

                <div className="mt-4 max-w-xs">
                  <label className="mb-1 block text-xs text-gray-500">
                    Check Hour (UTC)
                  </label>
                  <select
                    value={settings.priceCheckHour}
                    onChange={(e) =>
                      updateField(
                        "priceCheckHour",
                        Number.parseInt(e.target.value, 10) || 0
                      )
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {hour.toString().padStart(2, "0")}:00 UTC
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    Example: `06:00 UTC` matches a cron schedule of `0 6 * * *`.
                  </p>
                </div>

                <div className="mt-4 max-w-xs">
                  <label className="mb-1 block text-xs text-gray-500">
                    Amazon Delivery Postcode
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={settings.scrapePostcode}
                    onChange={(e) =>
                      updateField("scrapePostcode", e.target.value.replace(/\D/g, ""))
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. 2217"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    The scraper will set this postcode on Amazon to get local pricing
                    and availability. Default: 2217 (Kogarah, NSW).
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ===== SAVE BUTTON (shared across all sub-tabs) ===== */}
        <div className="mt-8 pt-4 border-t border-gray-200 flex items-center justify-end gap-4">
          <span className="text-xs text-gray-400">Changes will be applied only for the new products</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-pulse z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------- Helper Components ---------- */

function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2.5 text-sm ${disabled ? "text-gray-400" : "text-gray-700"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="rounded border-gray-300 text-orange-500 focus:ring-orange-500 disabled:opacity-40"
      />
      {label}
    </label>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? "bg-orange-500" : "bg-gray-300"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
