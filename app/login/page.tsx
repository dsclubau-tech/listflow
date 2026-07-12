"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { getSafeCallbackPath } from "@/lib/auth-navigation";

function LoginForm() {
  const [storeId, setStoreId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const callbackUrl = getSafeCallbackPath(searchParams.get("callbackUrl"));
  const authError = searchParams.get("error");
  const passwordChanged = searchParams.get("passwordChanged") === "1";

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ListFlow</h1>
            <p className="text-sm text-gray-500 mt-1">eBay listing tool</p>
          </div>

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
