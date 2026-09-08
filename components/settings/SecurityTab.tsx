"use client";

import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";

type PasswordField = "current" | "new" | "confirm" | "lockConfirm";

const passwordGuidelines = [
  "Any non-empty password is accepted",
  "Spaces and symbols are allowed",
  "Use a password you can reliably enter on every PC",
];

function PasswordInput({
  id,
  label,
  value,
  field,
  visible,
  disabled,
  autoComplete,
  onChange,
  onToggle,
  onCapsLockChange,
}: {
  id: string;
  label: string;
  value: string;
  field: PasswordField;
  visible: boolean;
  disabled: boolean;
  autoComplete: string;
  onChange: (value: string) => void;
  onToggle: (field: PasswordField) => void;
  onCapsLockChange: (active: boolean) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => onCapsLockChange(event.getModifierState("CapsLock"))}
          onKeyUp={(event) => onCapsLockChange(event.getModifierState("CapsLock"))}
          autoComplete={autoComplete}
          disabled={disabled}
          className="w-full rounded-md border border-gray-300 px-3 py-2 pr-20 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
        />
        <button
          type="button"
          onClick={() => onToggle(field)}
          disabled={disabled}
          className="absolute inset-y-1 right-1 rounded px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export default function SecurityTab() {
  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visibleFields, setVisibleFields] = useState<Record<PasswordField, boolean>>({
    current: false,
    new: false,
    confirm: false,
    lockConfirm: false,
  });
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Profile lock settings state
  const [lockSettingsLoading, setLockSettingsLoading] = useState(true);
  const [profileLockEnabled, setProfileLockEnabled] = useState(true);
  const [autoLockMinutes, setAutoLockMinutes] = useState(0);
  const [hasStorePassword, setHasStorePassword] = useState(false);
  const [lockPasswordConfirm, setLockPasswordConfirm] = useState("");
  const [savingLock, setSavingLock] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockSuccess, setLockSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfileLockSettings() {
      try {
        const res = await fetch("/api/stores/profile-lock/manage");
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setProfileLockEnabled(data.profileLockEnabled ?? true);
          setAutoLockMinutes(data.autoLockMinutes ?? 0);
          setHasStorePassword(data.hasPassword ?? false);
        }
      } catch {
        // Fallback to defaults
      } finally {
        setLockSettingsLoading(false);
      }
    }
    loadProfileLockSettings();
  }, []);

  function toggleVisible(field: PasswordField) {
    setVisibleFields((current) => ({
      ...current,
      [field]: !current[field],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/settings/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Failed to change password.");
        return;
      }

      setSuccess(data?.message || "Password changed. Sign in again with the new password.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      window.setTimeout(() => {
        void signOut({ callbackUrl: "/login?passwordChanged=1" });
      }, 900);
    } catch {
      setError("Network error while changing password.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLockSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLockError(null);
    setLockSuccess(null);

    if (hasStorePassword && !lockPasswordConfirm) {
      setLockError("Please enter your current store password to save profile lock settings.");
      return;
    }

    setSavingLock(true);

    try {
      const res = await fetch("/api/stores/profile-lock/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileLockEnabled,
          autoLockMinutes,
          currentPassword: lockPasswordConfirm,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setLockError(data?.error || "Failed to update profile lock settings.");
        return;
      }

      setLockSuccess("Profile lock settings saved successfully.");
      setLockPasswordConfirm("");
    } catch {
      setLockError("Network error while saving profile lock settings.");
    } finally {
      setSavingLock(false);
    }
  }

  async function handleTriggerLockNow() {
    try {
      await fetch("/api/stores/profile-lock/lock", { method: "POST" });
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* ── Store Profile Lock Card ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">
                Store Profile Lock
              </h2>
              {hasStorePassword && profileLockEnabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Password Protected
                </span>
              ) : !hasStorePassword ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  No Password Set
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  Lock Disabled
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Protect this store profile with your store password. Require authentication when switching workspaces or stepping away.
            </p>
          </div>

          {hasStorePassword && profileLockEnabled && (
            <button
              type="button"
              onClick={handleTriggerLockNow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Lock Now
            </button>
          )}
        </div>

        {lockSettingsLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Loading profile lock settings...
          </div>
        ) : (
          <form onSubmit={handleSaveLockSettings} className="space-y-5 px-5 py-5">
            {lockError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {lockError}
              </div>
            )}

            {lockSuccess && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {lockSuccess}
              </div>
            )}

            {/* Checkbox toggle: Enable profile lock */}
            <div className="flex items-start gap-3">
              <input
                id="profileLockEnabled"
                type="checkbox"
                checked={profileLockEnabled}
                onChange={(e) => setProfileLockEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
              />
              <div>
                <label
                  htmlFor="profileLockEnabled"
                  className="text-sm font-medium text-gray-900 cursor-pointer"
                >
                  Require store password when switching to this profile
                </label>
                <p className="text-xs text-gray-500 mt-0.5">
                  When enabled, any user selecting this store from the store switcher modal must enter this store&apos;s password to enter.
                </p>
              </div>
            </div>

            {/* Inactivity timeout */}
            <div className="pt-2 border-t border-gray-100">
              <label
                htmlFor="autoLockMinutes"
                className="block text-sm font-medium text-gray-700"
              >
                Auto-lock on inactivity
              </label>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                Automatically lock the workspace if no keyboard or mouse activity is detected.
              </p>
              <select
                id="autoLockMinutes"
                value={autoLockMinutes}
                onChange={(e) => setAutoLockMinutes(parseInt(e.target.value, 10))}
                className="w-full sm:w-64 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                <option value={0}>Disabled (Manual lock only)</option>
                <option value={5}>After 5 minutes</option>
                <option value={15}>After 15 minutes</option>
                <option value={30}>After 30 minutes</option>
                <option value={60}>After 1 hour</option>
              </select>
            </div>

            {/* Current password confirmation for saving */}
            {hasStorePassword && (
              <div className="pt-2 border-t border-gray-100">
                <PasswordInput
                  id="lockPasswordConfirm"
                  label="Confirm store password to save changes"
                  value={lockPasswordConfirm}
                  field="lockConfirm"
                  visible={visibleFields.lockConfirm}
                  disabled={savingLock}
                  autoComplete="current-password"
                  onChange={setLockPasswordConfirm}
                  onToggle={toggleVisible}
                  onCapsLockChange={setCapsLockActive}
                />
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingLock}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {savingLock ? "Saving..." : "Save Lock Settings"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Store Password Change Card ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Store Password
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Change the password used to sign in and unlock this store profile.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {success}
            </div>
          )}

          {capsLockActive && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Caps Lock is on.
            </div>
          )}

          <PasswordInput
            id="currentPassword"
            label="Current password"
            value={currentPassword}
            field="current"
            visible={visibleFields.current}
            disabled={saving}
            autoComplete="current-password"
            onChange={setCurrentPassword}
            onToggle={toggleVisible}
            onCapsLockChange={setCapsLockActive}
          />

          <PasswordInput
            id="newPassword"
            label="New password"
            value={newPassword}
            field="new"
            visible={visibleFields.new}
            disabled={saving}
            autoComplete="new-password"
            onChange={setNewPassword}
            onToggle={toggleVisible}
            onCapsLockChange={setCapsLockActive}
          />

          <PasswordInput
            id="confirmPassword"
            label="Confirm new password"
            value={confirmPassword}
            field="confirm"
            visible={visibleFields.confirm}
            disabled={saving}
            autoComplete="new-password"
            onChange={setConfirmPassword}
            onToggle={toggleVisible}
            onCapsLockChange={setCapsLockActive}
          />

          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">Password rules</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
              {passwordGuidelines.map((guideline) => (
                <li key={guideline}>{guideline}</li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {saving ? "Changing..." : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
