"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";

interface ProfileLockScreenProps {
  storeId: string;
  storeName: string;
  storeLoginId?: string;
  onUnlock: () => void;
  onOpenSwitcher: () => void;
}

export default function ProfileLockScreen({
  storeId,
  storeName,
  storeLoginId,
  onUnlock,
  onOpenSwitcher,
}: ProfileLockScreenProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      passwordInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter the store password.");
      triggerShake();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/stores/profile-lock/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(data?.error || "Incorrect password. Please try again.");
        triggerShake();
        setLoading(false);
        return;
      }

      // Success! Reset password and trigger onUnlock
      setPassword("");
      onUnlock();
    } catch {
      setError("Failed to verify password. Please check your connection.");
      triggerShake();
      setLoading(false);
    }
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const initial = (storeName || storeLoginId || "S").charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200/80 p-6 sm:p-8 flex flex-col items-center text-center animate-in zoom-in-95 duration-200 ${
          isShaking ? "animate-bounce" : ""
        }`}
      >
        {/* Avatar with lock emblem */}
        <div className="relative mb-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-teal-500 to-emerald-600 text-white shadow-xl shadow-teal-500/25 flex items-center justify-center font-extrabold text-3xl select-none">
            {initial}
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

        {/* Lock Title & Store Name */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-700 text-xs font-semibold mb-2">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Workspace Locked</span>
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          {storeName}
        </h2>
        {storeLoginId && (
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            {storeLoginId}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
          Enter this store&apos;s password to unlock your workspace and resume where you left off.
        </p>

        {/* Error Alert */}
        {error && (
          <div className="w-full mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 text-left animate-in fade-in duration-150">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={handleUnlock} className="w-full mt-5 space-y-4">
          <div className="text-left">
            <label
              htmlFor="workspace-lock-password"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Store Password
            </label>
            <div className="relative">
              <input
                ref={passwordInputRef}
                id="workspace-lock-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => setCapsLockActive(e.getModifierState("CapsLock"))}
                onKeyUp={(e) => setCapsLockActive(e.getModifierState("CapsLock"))}
                disabled={loading}
                placeholder="Enter store password"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 pr-20 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute inset-y-1 right-1 px-3 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-semibold text-sm transition-all duration-150 shadow-md shadow-teal-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Unlocking...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                <span>Unlock Workspace</span>
              </>
            )}
          </button>
        </form>

        {/* Action links */}
        <div className="mt-5 pt-4 border-t border-slate-100 w-full flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onOpenSwitcher}
            className="text-slate-500 hover:text-teal-600 font-medium transition-colors cursor-pointer flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Switch Profile</span>
          </button>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-slate-400 hover:text-red-600 font-medium transition-colors cursor-pointer flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
