"use client";

import { useState } from "react";
import SupplierSettingsTab from "@/components/settings/SupplierSettingsTab";
import TemplatesTab from "@/components/settings/TemplatesTab";
import KeywordsTab from "@/components/settings/KeywordsTab";
import DangerZoneTab from "@/components/settings/DangerZoneTab";
import SecurityTab from "@/components/settings/SecurityTab";
import DiagnosticsTab from "@/components/settings/DiagnosticsTab";
import StoreProfileTab from "@/components/settings/StoreProfileTab";

const tabs = [
  "Store Profile",
  "Supplier Settings",
  "Templates",
  "Keywords",
  "Security",
  "Diagnostics",
  "Danger Zone",
] as const;
type Tab = (typeof tabs)[number];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Store Profile");

  return (
    <div className="min-h-full px-4 py-5 md:px-6 md:py-7 2xl:p-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Settings</h1>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto no-scrollbar">
        <nav className="flex gap-4 sm:gap-6 whitespace-nowrap min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "Store Profile" && <StoreProfileTab />}
      {activeTab === "Supplier Settings" && <SupplierSettingsTab />}
      {activeTab === "Templates" && <TemplatesTab />}
      {activeTab === "Keywords" && <KeywordsTab />}
      {activeTab === "Security" && <SecurityTab />}
      {activeTab === "Diagnostics" && <DiagnosticsTab />}
      {activeTab === "Danger Zone" && <DangerZoneTab />}
    </div>
  );
}
