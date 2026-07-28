"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface PageRefreshButtonProps {
  className?: string;
}

export default function PageRefreshButton({
  className = "",
}: PageRefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const label = isRefreshing ? "Refreshing page" : "Refresh page";

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={isRefreshing}
      aria-label={label}
      aria-busy={isRefreshing || undefined}
      title={label}
      className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      <svg
        className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5m-5 4a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5"
        />
      </svg>
    </button>
  );
}
