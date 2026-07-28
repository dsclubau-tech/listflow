"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  hasStoreLoginIdWhitespace,
  STORE_LOGIN_ID_WHITESPACE_ERROR,
} from "@/lib/store-login-id";

export default function RegisterPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLoginIdChange = (value: string) => {
    setLoginId(value.toLowerCase());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (hasStoreLoginIdWhitespace(loginId)) {
      setError(STORE_LOGIN_ID_WHITESPACE_ERROR);
      return;
    }

    if (!/^[a-z0-9-]+$/.test(loginId)) {
      setError(
        "Store ID can only contain lowercase letters, numbers, and hyphens.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName,
          loginId,
          password,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create account. Please try again.");
        setIsLoading(false);
      } else {
        router.push(`/login?registered=1&storeId=${encodeURIComponent(loginId)}`);
      }
    } catch {
      setError("An unexpected network error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ListFlow</h1>
            <p className="text-sm text-gray-500 mt-1">Create your Store Account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="storeName"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Store Display Name
              </label>
              <input
                id="storeName"
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
                maxLength={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 text-gray-900"
                placeholder="e.g. My eBay Store"
                disabled={isLoading}
              />
            </div>

            <div>
              <label
                htmlFor="loginId"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Store ID (Login Handle)
              </label>
              <input
                id="loginId"
                type="text"
                value={loginId}
                onChange={(e) => handleLoginIdChange(e.target.value)}
                required
                minLength={3}
                maxLength={64}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 text-gray-900"
                placeholder="e.g. my-store-1"
                disabled={isLoading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Used to log in. Lowercase letters, numbers, and hyphens only.
                Spaces are not allowed.
              </p>
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
                  autoComplete="new-password"
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
              <p className="mt-1 text-xs text-gray-500">
                At least 8 chars, 1 uppercase, 1 lowercase, 1 number.
              </p>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(event) =>
                  setCapsLockActive(event.getModifierState("CapsLock"))
                }
                onKeyUp={(event) =>
                  setCapsLockActive(event.getModifierState("CapsLock"))
                }
                required
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 text-gray-900"
                placeholder="********"
                disabled={isLoading}
              />
              {capsLockActive && (
                <p className="mt-2 text-xs text-amber-700">Caps Lock is on.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-orange-600 text-white font-medium rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          {error && (
            <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
          )}

          <div className="mt-6 text-center border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-600">
              Already have a store account?{" "}
              <Link
                href="/login"
                className="font-medium text-orange-600 hover:text-orange-500 underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
