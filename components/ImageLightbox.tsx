/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ImageLightboxProps {
  images: string[];
  activeIndex: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function ImageLightbox({
  images,
  activeIndex,
  onClose,
  onIndexChange,
}: ImageLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentIndex =
    activeIndex === null || images.length === 0
      ? -1
      : Math.min(Math.max(activeIndex, 0), images.length - 1);
  const isOpen = currentIndex >= 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (images.length <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((currentIndex - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((currentIndex + 1) % images.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, images.length, isOpen, onClose, onIndexChange]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const imageUrl = images[currentIndex];
  const showNavigation = images.length > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Product image ${currentIndex + 1} of ${images.length}`}
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={`Product image ${currentIndex + 1} of ${images.length}`}
          className="max-h-full max-w-full select-none object-contain"
          draggable={false}
        />

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-white hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>

        {showNavigation && (
          <>
            <button
              type="button"
              onClick={() =>
                onIndexChange(
                  (currentIndex - 1 + images.length) % images.length,
                )
              }
              aria-label="View previous image"
              className="absolute left-0 inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-white hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              <svg
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="m15 18-6-6 6-6"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                onIndexChange((currentIndex + 1) % images.length)
              }
              aria-label="View next image"
              className="absolute right-0 inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-white hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              <svg
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="m9 18 6-6-6-6"
                />
              </svg>
            </button>
          </>
        )}

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-sm font-medium text-white">
          {currentIndex + 1} / {images.length}
        </div>
      </div>
    </div>,
    document.body,
  );
}
