"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_STORE_DISPLAY_NAME_LENGTH } from "@/lib/store-profile";

type StoreProfile = {
  id: string;
  name: string;
  loginId: string | null;
};

export default function StoreProfileTab() {
  const router = useRouter();
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response = await fetch("/api/stores");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to load the store profile.");
        }

        const current = (data as StoreProfile[])[0];
        if (!current) {
          throw new Error("Store profile not found.");
        }

        if (!cancelled) {
          setProfile(current);
          setName(current.name);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the store profile.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedName = useMemo(
    () => name.trim().replace(/\s+/g, " "),
    [name],
  );
  const canSave =
    Boolean(profile) &&
    normalizedName.length > 0 &&
    normalizedName.length <= MAX_STORE_DISPLAY_NAME_LENGTH &&
    normalizedName !== profile?.name &&
    !saving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to update the store name.");
      }

      const updated = data.store as StoreProfile;
      setProfile(updated);
      setName(updated.name);
      setSuccess(data.message || "Store name updated.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update the store name.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading store profile...</p>;
  }

  return (
    <section className="max-w-2xl border border-gray-200 bg-white rounded-lg">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">Store profile</h2>
        <p className="mt-1 text-sm text-gray-500">
          This name appears throughout ListFlow and does not change your eBay login.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
        <div>
          <label
            htmlFor="store-display-name"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Store name
          </label>
          <input
            id="store-display-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              setSuccess(null);
            }}
            maxLength={MAX_STORE_DISPLAY_NAME_LENGTH}
            autoComplete="organization"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {name.length}/{MAX_STORE_DISPLAY_NAME_LENGTH}
          </p>
        </div>

        <div>
          <label
            htmlFor="store-login-id"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Store login ID
          </label>
          <input
            id="store-login-id"
            type="text"
            value={profile?.loginId || ""}
            readOnly
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
          />
          <p className="mt-1.5 text-xs text-gray-500">
            Your login ID stays the same when the display name changes.
          </p>
        </div>

        <div aria-live="polite">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-700">{success}</p>}
        </div>

        <div className="flex justify-end border-t border-gray-200 pt-5">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save name"}
          </button>
        </div>
      </form>
    </section>
  );
}
