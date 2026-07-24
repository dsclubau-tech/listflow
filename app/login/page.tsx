"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { getSafeCallbackPath } from "@/lib/auth-navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const initialStoreId = searchParams.get("storeId") || "";
  const [storeId, setStoreId] = useState(initialStoreId);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const callbackUrl = getSafeCallbackPath(searchParams.get("callbackUrl"));
  const authError = searchParams.get("error");
  const passwordChanged = searchParams.get("passwordChanged") === "1";
  const justRegistered = searchParams.get("registered") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        storeId,
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ListFlow</h1>
            <p className="text-sm text-gray-500 mt-1">eBay listing tool</p>
          </div>

          {justRegistered && !(error || authError) && (
            <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800 text-center">
              Account created successfully! Please sign in below.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="storeId"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Store ID
              </label>
              <input
                id="storeId"
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                required
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 text-gray-900"
                placeholder="store-1"
                disabled={isLoading}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(event) =>
                    setCapsLockActive(event.getModifierState("CapsLock"))
                  }
                  onKeyUp={(event) =>
                    setCapsLockActive(event.getModifierState("CapsLock"))
                  }
                  required
                  autoComplete="current-password"
                  className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 text-gray-900"
                  placeholder="********"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={isLoading}
                  className="absolute inset-y-1 right-1 rounded px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {capsLockActive && (
                <p className="mt-2 text-xs text-amber-700">Caps Lock is on.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-gray-900 text-white font-medium rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {(error || authError) && (
            <p className="mt-4 text-sm text-red-600 text-center">
              {error || "Authentication failed. Please try again."}
            </p>
          )}
          {passwordChanged && !(error || authError) && (
            <p className="mt-4 text-sm text-green-700 text-center">
              Password changed. Sign in with the new password.
            </p>
          )}

          <div className="mt-6 text-center border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-600">
              Don&apos;t have a store account?{" "}
              <Link
                href="/register"
                className="font-medium text-orange-600 hover:text-orange-500 underline underline-offset-2"
              >
                Register
              </Link>
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
