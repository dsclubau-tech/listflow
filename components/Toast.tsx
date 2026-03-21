"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  variant: "success" | "error";
  onClose: () => void;
}

export default function Toast({ message, variant, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 3000);

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <div
        className={`bg-white rounded-lg shadow-lg border px-4 py-3 flex items-center gap-3 text-sm min-w-[280px] ${
          variant === "success"
            ? "border-l-4 border-l-green-500"
            : "border-l-4 border-l-red-500"
        }`}
      >
        <span className="flex-1 text-gray-700">{message}</span>
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onClose, 300);
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
