"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { getSafeCallbackPath } from "@/lib/auth-navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const initialLogin = searchParams.get("storeId") || searchParams.get("email") || "";
  const [identifier, setIdentifier] = useState(initialLogin);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const callbackUrl = getSafeCallbackPath(searchParams.get("callbackUrl"));
  const authError = searchParams.get("error");
  const passwordChanged = searchParams.get("passwordChanged") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = identifier.trim();
    if (!trimmed) {
      setError("Please enter your email or store ID.");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Primary path: Email sign-in via Automation Alchemists Supabase Auth
      if (trimmed.includes("@")) {
        const supabase = createClient();
        const { error: sbError } = await supabase.auth.signInWithPassword({
          email: trimmed.toLowerCase(),
          password,
        });

        if (sbError) {
          setError(
            sbError.message === "Invalid login credentials"
              ? "Invalid email or password. Please check your credentials."
              : sbError.message
          );
          setIsLoading(false);
          return;
        }

        // Successfully authenticated with AA Supabase
        window.location.assign(callbackUrl);
        return;
      }

      // 2. Legacy path: Store ID credentials authentication
      const result = await signIn("credentials", {
        storeId: trimmed.toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid store ID or password. Please try again.");
        setIsLoading(false);
      } else {
        window.location.assign(callbackUrl);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-tertiary py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-primary tracking-tight">ListFlow</h1>
            <p className="text-xs font-semibold tracking-wider text-indigo-600 uppercase mt-1">
              by Automation Alchemists
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email Address or Store ID
              </label>
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary text-gray-900 text-sm"
                placeholder="you@example.com or store-1"
                disabled={isLoading}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (typeof e.getModifierState === "function") {
                    setCapsLockActive(e.getModifierState("CapsLock"));
                  }
                }}
                onKeyUp={(e) => {
                  if (typeof e.getModifierState === "function") {
                    setCapsLockActive(e.getModifierState("CapsLock"));
                  }
                }}
                required
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary text-gray-900 text-sm"
                disabled={isLoading}
              />
              {capsLockActive && (
                <p className="mt-1 text-xs text-amber-600">
                  Caps Lock is ON
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary hover:bg-slate-850 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          {(error || authError) && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-xs text-red-600 text-center font-medium">
                {error || "Authentication failed. Please try again."}
              </p>
            </div>
          )}

          {passwordChanged && !(error || authError) && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-xs text-green-700 text-center font-medium">
                Password changed successfully. Sign in with your new password.
              </p>
            </div>
          )}

          <div className="mt-6 text-center border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500">
              Accounts are centrally managed via{" "}
              <span className="font-semibold text-gray-700">Automation Alchemists</span>.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Need access? Please contact your account administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-tertiary">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
