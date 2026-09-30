"use client";

import { useEffect, useRef, useState } from "react";

interface ToastProps {
  message: string;
  variant: "success" | "error";
  onClose: () => void;
  position?: "fixed" | "inline";
}

export default function Toast({ message, variant, onClose, position = "fixed" }: ToastProps) {
  const [hiddenMessage, setHiddenMessage] = useState<string | null>(null);
  const visible = hiddenMessage !== message;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHiddenMessage(message);
      closeTimer.current = setTimeout(onClose, 300);
    }, 3000);

    return () => { clearTimeout(timer); if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, [message, onClose]);

  return (
    <div
      role="status"
      className={`pointer-events-auto ${position === "fixed" ? "fixed bottom-4 right-4 z-50" : "w-full"} transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      } ${!visible ? "pointer-events-none" : ""}`}
    >
      <div
        className={`bg-white rounded-lg shadow-lg border px-4 py-3 flex items-center gap-3 text-sm ${position === "fixed" ? "min-w-[280px]" : "min-w-0 w-full"} ${
          variant === "success"
            ? "border-l-4 border-l-green-500"
            : "border-l-4 border-l-red-500"
        }`}
      >
        <span className="min-w-0 flex-1 break-words text-gray-700">{message}</span>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => {
            setHiddenMessage(message);
            if (closeTimer.current) clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(onClose, 300);
          }}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
