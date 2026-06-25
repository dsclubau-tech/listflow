"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

type PasswordField = "current" | "new" | "confirm";

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
          className="absolute inset-y-1 right-1 rounded px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export default function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visibleFields, setVisibleFields] = useState<Record<PasswordField, boolean>>({
    current: false,
    new: false,
    confirm: false,
  });
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Store password
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Change the password used to sign in to the current store profile.
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
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Changing..." : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
