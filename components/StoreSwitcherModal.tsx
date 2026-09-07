"use client";

import { useEffect, useState } from "react";
import type { StoreOption } from "@/lib/store-session";

interface StoreSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: StoreOption[];
  currentStoreId?: string;
}

// Curated palette of gradient avatars matching ListFlow's mint/teal/blue/amber design tokens
const AVATAR_GRADIENTS = [
  {
    gradient: "from-teal-400 via-teal-500 to-emerald-600",
    shadow: "shadow-teal-500/25",
    text: "text-white",
    bgLight: "bg-teal-50 text-teal-700",
  },
  {
    gradient: "from-sky-400 via-blue-500 to-indigo-600",
    shadow: "shadow-blue-500/25",
    text: "text-white",
    bgLight: "bg-blue-50 text-blue-700",
  },
  {
    gradient: "from-amber-400 via-amber-500 to-orange-500",
    shadow: "shadow-amber-500/25",
    text: "text-white",
    bgLight: "bg-amber-50 text-amber-700",
  },
  {
    gradient: "from-emerald-400 via-emerald-500 to-teal-600",
    shadow: "shadow-emerald-500/25",
    text: "text-white",
    bgLight: "bg-emerald-50 text-emerald-700",
  },
];

export default function StoreSwitcherModal({
  isOpen,
  onClose,
  stores,
  currentStoreId,
}: StoreSwitcherModalProps) {
  const [switchingStoreId, setSwitchingStoreId] = useState<string | null>(null);
  const [showAddInfo, setShowAddInfo] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddInfo) {
          setShowAddInfo(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showAddInfo, onClose]);

  if (!isOpen) return null;

  const handleSelectStore = (storeId: string) => {
    if (storeId === currentStoreId) {
      onClose();
      return;
    }

    setSwitchingStoreId(storeId);

    // Set cookie listflow_active_store_id for 1 year
    document.cookie = `listflow_active_store_id=${encodeURIComponent(
      storeId
    )}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    // Refresh page to load the dashboard scoped to the newly selected store
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/75 backdrop-blur-md transition-opacity"
        onClick={() => {
          if (!switchingStoreId) {
            onClose();
            setShowAddInfo(false);
          }
        }}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-3xl sm:max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200/80 p-6 sm:p-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {!showAddInfo ? (
          <>
            {/* Header */}
            <div className="text-center mb-8 sm:mb-10 max-w-md">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200/60 text-teal-700 text-xs font-semibold uppercase tracking-wider mb-3">
                <svg className="w-3.5 h-3.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
                <span>Store Profile Switcher</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Who&apos;s using ListFlow?
              </h2>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                Choose a store profile to switch workspace, active inventory, and price checking.
              </p>
            </div>

            {/* Centered Grid of Store Profile Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 w-full items-stretch justify-center">
              {stores.map((store, index) => {
                const isCurrent = store.id === currentStoreId;
                const isSwitching = store.id === switchingStoreId;
                const style = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
                const initial = (store.name || store.loginId || "S").charAt(0).toUpperCase();

                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => handleSelectStore(store.id)}
                    disabled={!!switchingStoreId}
                    className={`group relative flex flex-col items-center justify-center p-4 sm:p-6 rounded-2xl bg-white border transition-all duration-200 text-center ${
                      isCurrent
                        ? "border-teal-500 shadow-md ring-2 ring-teal-500/20 bg-teal-50/10"
                        : "border-slate-200 hover:border-teal-400 hover:shadow-xl hover:-translate-y-1"
                    }`}
                  >
                    {/* Active Pill Badge */}
                    {isCurrent && (
                      <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
                        Active
                      </span>
                    )}

                    {/* Circular Avatar / Icon */}
                    <div
                      className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr ${style.gradient} ${style.text} ${style.shadow} shadow-lg flex items-center justify-center font-extrabold text-2xl sm:text-3xl mb-3 transition-transform duration-200 group-hover:scale-105 select-none`}
                    >
                      {isSwitching ? (
                        <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        initial
                      )}
                    </div>

                    {/* Store Name */}
                    <p className="font-bold text-slate-800 text-sm sm:text-base leading-snug line-clamp-2 w-full group-hover:text-teal-600 transition-colors">
                      {store.name}
                    </p>

                    {/* Store Login ID / Subtitle */}
                    <p className="text-xs text-slate-400 font-medium truncate w-full mt-1">
                      {isSwitching ? "Switching..." : store.loginId || store.id}
                    </p>
                  </button>
                );
              })}

              {/* Dashed-Border "Add Store" Card */}
              <button
                type="button"
                onClick={() => setShowAddInfo(true)}
                disabled={!!switchingStoreId}
                className="group relative flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/20 transition-all duration-200 text-center cursor-pointer"
              >
                {/* Circular Plus Icon Container */}
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-50 border border-slate-200 group-hover:border-teal-400 group-hover:bg-teal-100/50 flex items-center justify-center text-slate-400 group-hover:text-teal-600 transition-all duration-200 mb-3 select-none">
                  <svg className="w-8 h-8 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>

                {/* Add Store Label */}
                <p className="font-semibold text-slate-600 text-sm sm:text-base leading-snug group-hover:text-teal-700 transition-colors">
                  Add Store
                </p>

                {/* Subtitle */}
                <p className="text-xs text-slate-400 font-medium mt-1">
                  New Slot
                </p>
              </button>
            </div>
          </>
        ) : (
          /* Add Store Contact Info View */
          <div className="w-full max-w-md py-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto mb-4 text-teal-600">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-slate-900">Connect a New Store</h3>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              Self-serve store onboarding is in active development. To connect a new eBay store or allocate additional store slots to your account, please contact Automation Alchemists support.
            </p>

            <div className="mt-6 space-y-3">
              <a
                href="mailto:support@automationalchemists.com?subject=ListFlow%20New%20Store%20Request"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-medium text-sm transition-all duration-150 shadow-md shadow-teal-600/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                Contact Support
              </a>

              <button
                type="button"
                onClick={() => setShowAddInfo(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors"
              >
                Back to Stores
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
