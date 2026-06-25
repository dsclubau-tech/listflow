"use client";

import { useState } from "react";
import SupplierSettingsTab from "@/components/settings/SupplierSettingsTab";
import TemplatesTab from "@/components/settings/TemplatesTab";
import KeywordsTab from "@/components/settings/KeywordsTab";
import DangerZoneTab from "@/components/settings/DangerZoneTab";
import SecurityTab from "@/components/settings/SecurityTab";

const tabs = ["Supplier Settings", "Templates", "Keywords", "Security", "Danger Zone"] as const;
type Tab = (typeof tabs)[number];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Supplier Settings");

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Settings</h1>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
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
      {activeTab === "Supplier Settings" && <SupplierSettingsTab />}
      {activeTab === "Templates" && <TemplatesTab />}
      {activeTab === "Keywords" && <KeywordsTab />}
      {activeTab === "Security" && <SecurityTab />}
      {activeTab === "Danger Zone" && <DangerZoneTab />}
    </div>
  );
}
