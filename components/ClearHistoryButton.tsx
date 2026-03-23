"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ClearHistoryButtonProps {
  onToast?: (message: string, variant: "success" | "error") => void;
}

export default function ClearHistoryButton({ onToast }: ClearHistoryButtonProps) {
  const [isClearing, setIsClearing] = useState(false);
  const router = useRouter();

  async function handleClear() {
    const confirmed = window.confirm(
      "Are you sure you want to clear all upload history? This cannot be undone."
    );
    if (!confirmed) return;

    setIsClearing(true);
    try {
      const res = await fetch("/api/upload-history", { method: "DELETE" });
      if (res.ok) {
        if (onToast) onToast("Upload history cleared", "success");
        router.refresh();
      } else {
        const data = await res.json();
        if (onToast) onToast(data.error || "Failed to clear history", "error");
      }
    } catch {
      if (onToast) onToast("Failed to clear history", "error");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <button
      onClick={handleClear}
      disabled={isClearing}
      className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
    >
      {isClearing ? "Clearing…" : "Clear History"}
    </button>
  );
}
