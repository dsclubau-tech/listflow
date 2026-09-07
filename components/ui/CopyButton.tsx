"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from "react";

export interface CopyButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> {
  text: string;
  label?: string;
  title?: string;
  size?: "xs" | "sm";
  stopPropagation?: boolean;
  onCopy?: () => void;
}

export default function CopyButton({
  text,
  label = "Copy",
  title,
  size = "xs",
  stopPropagation = true,
  onCopy,
  className = "",
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      event.stopPropagation();
    }
    event.preventDefault();

    const value = text?.trim();
    if (!value) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = value;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      setCopied(true);
      onCopy?.();

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Gracefully handle clipboard write rejection
    }
  }

  const iconClass = size === "sm" ? "h-4 w-4" : "h-3.5 w-3.5";
  const paddingClass = size === "sm" ? "p-1" : "p-0.5";
  const displayTitle = copied ? "Copied!" : title ?? label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={displayTitle}
      aria-label={displayTitle}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400 ${paddingClass} ${
        copied
          ? "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      } ${className}`}
      {...props}
    >
      {copied ? (
        <svg
          className={`${iconClass} text-emerald-600`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          className={iconClass}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
