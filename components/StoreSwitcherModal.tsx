"use client";

import { useEffect, useState, useRef } from "react";
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

  // Password challenge state
  const [pendingUnlockStore, setPendingUnlockStore] = useState<StoreOption | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setPendingUnlockStore(null);
      setPassword("");
      setUnlockError(null);
      setShowAddInfo(false);
      setSwitchingStoreId(null);
    }
  }, [isOpen]);

  // Focus password input when challenge view appears
  useEffect(() => {
    if (pendingUnlockStore) {
      const timer = setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingUnlockStore]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingUnlockStore) {
          setPendingUnlockStore(null);
          setPassword("");
          setUnlockError(null);
        } else if (showAddInfo) {
          setShowAddInfo(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showAddInfo, pendingUnlockStore, onClose]);

  if (!isOpen) return null;

  const handleSelectStore = (store: StoreOption) => {
    if (store.id === currentStoreId) {
      onClose();
      return;
    }

    // Check if store requires password unlock
    const isLocked = store.profileLockEnabled !== false && store.hasPassword;
    if (isLocked) {
      setPendingUnlockStore(store);
      setPassword("");
      setUnlockError(null);
      return;
    }

    // Direct switch for stores without password protection
    directSwitchToStore(store.id);
  };

  const directSwitchToStore = (storeId: string) => {
    setSwitchingStoreId(storeId);
    document.cookie = `listflow_active_store_id=${encodeURIComponent(
      storeId
    )}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    window.location.reload();
  };

  const handleUnlockAndSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUnlockStore) return;

    if (!password.trim()) {
      setUnlockError("Please enter the store password.");
      triggerShake();
      return;
    }

    setUnlockLoading(true);
    setUnlockError(null);

    try {
      const res = await fetch("/api/stores/profile-lock/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: pendingUnlockStore.id,
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setUnlockError(data?.error || "Incorrect password. Please try again.");
        triggerShake();
        setUnlockLoading(false);
        return;
      }

      // Successfully unlocked! Set active store cookie and reload
      directSwitchToStore(pendingUnlockStore.id);
    } catch {
      setUnlockError("Failed to verify password. Please try again.");
      triggerShake();
      setUnlockLoading(false);
    }
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/75 backdrop-blur-md transition-opacity"
        onClick={() => {
          if (!switchingStoreId && !unlockLoading) {
            if (pendingUnlockStore) {
              setPendingUnlockStore(null);
            } else if (showAddInfo) {
              setShowAddInfo(false);
            } else {
              onClose();
            }
          }
        }}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-3xl sm:max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200/80 p-6 sm:p-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          type="button"
          onClick={() => {
            if (pendingUnlockStore) {
              setPendingUnlockStore(null);
            } else if (showAddInfo) {
              setShowAddInfo(false);
            } else {
              onClose();
            }
          }}
          aria-label="Close"
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {pendingUnlockStore ? (
          /* ── Password Challenge View ── */
          <div
            className={`w-full max-w-md py-2 flex flex-col items-center text-center ${
              isShaking ? "animate-bounce" : ""
            }`}
          >
            {/* Store Avatar with Lock Badge */}
            <div className="relative mb-4">
              <div
                className={`w-20 h-20 rounded-full bg-gradient-to-tr from-teal-500 to-emerald-600 text-white shadow-xl shadow-teal-500/25 flex items-center justify-center font-extrabold text-3xl select-none`}
              >
                {(pendingUnlockStore.name || pendingUnlockStore.loginId || "S")
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 text-white border-2 border-white shadow-md flex items-center justify-center">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Unlock {pendingUnlockStore.name}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Enter the store password for{" "}
              <span className="font-semibold text-slate-700">
                {pendingUnlockStore.loginId || pendingUnlockStore.name}
              </span>{" "}
              to switch workspaces.
            </p>

            {/* Error Message */}
            {unlockError && (
              <div className="w-full mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 text-left animate-in fade-in duration-150">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{unlockError}</span>
              </div>
            )}

            {/* Password Form */}
            <form onSubmit={handleUnlockAndSwitch} className="w-full mt-5 space-y-4">
              <div className="text-left">
                <label
                  htmlFor="profile-unlock-password"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Store Password
                </label>
                <div className="relative">
                  <input
                    ref={passwordInputRef}
                    id="profile-unlock-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => setCapsLockActive(e.getModifierState("CapsLock"))}
                    onKeyUp={(e) => setCapsLockActive(e.getModifierState("CapsLock"))}
                    disabled={unlockLoading}
                    placeholder="Enter store password"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 pr-20 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={unlockLoading}
                    className="absolute inset-y-1 right-1 px-3 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {capsLockActive && (
                  <p className="mt-1.5 text-[11px] font-medium text-amber-600 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Caps Lock is ON
                  </p>
                )}
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="submit"
                  disabled={unlockLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-semibold text-sm transition-all duration-150 shadow-md shadow-teal-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {unlockLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                      <span>Unlock & Switch</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPendingUnlockStore(null);
                    setPassword("");
                    setUnlockError(null);
                  }}
                  disabled={unlockLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition-colors cursor-pointer"
                >
                  Back to Profiles
                </button>
              </div>
            </form>
          </div>
        ) : !showAddInfo ? (
          /* ── Store Grid View ── */
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
                const isLocked = store.profileLockEnabled !== false && store.hasPassword;
                const style = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
                const initial = (store.name || store.loginId || "S").charAt(0).toUpperCase();

                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => handleSelectStore(store)}
                    disabled={!!switchingStoreId || unlockLoading}
                    className={`group relative flex flex-col items-center justify-center p-4 sm:p-6 rounded-2xl bg-white border transition-all duration-200 text-center cursor-pointer ${
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

                    {/* Lock Icon Badge for Protected Profiles */}
                    {!isCurrent && isLocked && (
                      <span
                        title="Password Protected"
                        className="absolute top-2.5 right-2.5 p-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200/80 group-hover:bg-amber-50 group-hover:text-amber-600 group-hover:border-amber-200 transition-colors shadow-xs"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                          />
                        </svg>
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
                      {isSwitching
                        ? "Switching..."
                        : isLocked && !isCurrent
                        ? "Password Locked"
                        : store.loginId || store.id}
                    </p>
                  </button>
                );
              })}

              {/* Dashed-Border "Add Store" Card */}
              <button
                type="button"
                onClick={() => setShowAddInfo(true)}
                disabled={!!switchingStoreId || unlockLoading}
                className="group relative flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/20 transition-all duration-200 text-center cursor-pointer"
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-50 border border-slate-200 group-hover:border-teal-400 group-hover:bg-teal-100/50 flex items-center justify-center text-slate-400 group-hover:text-teal-600 transition-all duration-200 mb-3 select-none">
                  <svg className="w-8 h-8 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>

                <p className="font-semibold text-slate-600 text-sm sm:text-base leading-snug group-hover:text-teal-700 transition-colors">
                  Add Store
                </p>

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
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors cursor-pointer"
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
