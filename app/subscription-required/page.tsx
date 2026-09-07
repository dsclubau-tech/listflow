"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SubscriptionRequiredPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "error" | "info" | "success";
    text: string;
  } | null>(null);

  const handleRefreshSubscription = async () => {
    try {
      setRefreshing(true);
      setStatusMessage(null);

      const res = await fetch("/api/entitlement/refresh", {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatusMessage({
          type: "error",
          text: data.error || "Failed to check subscription. Please try again.",
        });
        setRefreshing(false);
        return;
      }

      if (data.status === "ACTIVE" && data.allowedStores > 0) {
        setStatusMessage({
          type: "success",
          text: `Subscription active (${data.allowedStores} store slot${data.allowedStores > 1 ? "s" : ""})! Entering ListFlow...`,
        });
        router.push("/");
        router.refresh();
      } else {
        setStatusMessage({
          type: "info",
          text: "No active subscription detected yet on Automation Alchemists. If you recently updated your grants, please allow a moment and try again.",
        });
        setRefreshing(false);
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Network error checking subscription status. Please try again.",
      });
      setRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 flex items-center justify-center p-4 text-slate-100">
      <div className="max-w-md w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl shadow-2xl p-8 backdrop-blur-sm">
        {/* Icon & Brand */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400 shadow-inner">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <span className="text-xs font-semibold tracking-wider text-amber-400 uppercase bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20 mb-3">
            Automation Alchemists
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Subscription Required
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Access to ListFlow requires an active subscription or granted store slots on Automation Alchemists.
          </p>
        </div>

        {/* Informational Card */}
        <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800 mb-6 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-slate-300">
              i
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your account is authenticated, but no active subscription or store entitlement was found for this user.
            </p>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              Subscriptions are managed centrally via the Automation Alchemists portal. If you recently purchased or updated your subscription, click <strong>Refresh Subscription</strong> below.
            </p>
          </div>
        </div>

        {/* Status Message Banner */}
        {statusMessage && (
          <div
            className={`mb-6 p-3 rounded-xl border text-xs leading-relaxed ${
              statusMessage.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : statusMessage.type === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                : "bg-amber-500/10 border-amber-500/30 text-amber-200"
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleRefreshSubscription}
            disabled={refreshing || signingOut}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all duration-150 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
          >
            {refreshing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Checking Entitlement...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh Subscription
              </>
            )}
          </button>

          <a
            href="mailto:support@automationalchemists.com"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all duration-150 shadow-lg shadow-indigo-600/20"
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
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            Contact Support
          </a>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut || refreshing}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm border border-slate-700 transition-all duration-150 disabled:opacity-50"
          >
            {signingOut ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </div>
    </div>
  );
}
