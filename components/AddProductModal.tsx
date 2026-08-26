"use client";

import ActionProgressBar from "@/components/ActionProgressBar";
import { getAddProductUrlValidationError } from "@/components/add-product-validation";
import { useTimedActionProgress } from "@/hooks/useTimedActionProgress";
import {
  DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  getAmazonPriceTrackingLabel,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DuplicateDraftError } from "@/components/draft-autosave";
import type { ExistingProductConflict } from "@/types/product-duplicate";
import Button from "@/components/ui/Button";
import {
  AmazonImportRequestError,
  getAmazonImportStageMessage,
  runQueuedAmazonImport,
  type AmazonImportProgress,
} from "@/components/amazon-import-client";

interface AddProductModalProps {
  isOpen: boolean;
  mode?: AddProductMode;
  onClose: () => void;
  onScraped: (
    data: ScrapedProduct,
    context: { background: boolean },
  ) => void | Promise<void>;
  onBackgroundStarted?: (url: string) => void;
  onBackgroundProgress?: (progress: AmazonImportProgress) => void;
  onBackgroundFailed?: (
    message: string,
    existing?: ExistingProductConflict,
  ) => void;
  onOpenExisting?: (existing: ExistingProductConflict) => void;
}

export interface ScrapedProduct {
  title: string;
  fullTitle?: string;
  description: string;
  images: string[];
  price: number | null;
  condition: "New";
  category: string;
  categoryId: string;
  categoryName: string;
  itemSpecifics: Record<string, string>;
  variantName: string | null;
  asin: string;
  brand: string;
  amazonPriceTrackingMode?: AmazonPriceTrackingMode;
  priceChoices?: {
    regular: { price: number; label: string } | null;
    deal: { price: number; label: string } | null;
  };
  supplierDefaults?: {
    quantity: number;
    country: string;
    zipcode: string;
    shippingMethod: string;
    storeNumber: number;
    shippingPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
    policyTemplateId: string | null;
    capitalizeTitle: boolean;
    defaultItemSpecifics: Record<string, string>;
  };
}

export type AddProductMode = "normal" | "advanced";

export default function AddProductModal({
  isOpen,
  mode = "normal",
  onClose,
  onScraped,
  onBackgroundStarted,
  onBackgroundProgress,
  onBackgroundFailed,
  onOpenExisting,
}: AddProductModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [queueProgress, setQueueProgress] = useState(0);
  const [queueDetail, setQueueDetail] = useState("");
  const [scrapedProduct, setScrapedProduct] = useState<ScrapedProduct | null>(
    null
  );
  const [duplicateProduct, setDuplicateProduct] =
    useState<ExistingProductConflict | null>(null);
  const [selectedMode, setSelectedMode] =
    useState<AmazonPriceTrackingMode>(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
  const dialogRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const importProgress = useTimedActionProgress(isLoading, {
    initialPercent: 12,
    maxWaitingPercent: 90,
    stepPercent: 8,
  });
  const handleClose = useCallback(() => {
    if (!isLoading) {
      setUrl("");
      setError("");
      setScrapedProduct(null);
      setDuplicateProduct(null);
      setQueueProgress(0);
      setQueueDetail("");
      setSelectedMode(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
      onClose();
    }
  }, [isLoading, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => urlInputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isLoading) {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
        ),
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [handleClose, isLoading, isOpen]);

  if (!isOpen) return null;

  const regularChoice = scrapedProduct?.priceChoices?.regular ?? null;
  const dealChoice = scrapedProduct?.priceChoices?.deal ?? null;
  const selectedChoice =
    selectedMode === "DEAL" ? dealChoice : regularChoice;
  const isAdvancedMode = mode === "advanced";

  async function handleImport() {
    if (!isAdvancedMode) {
      return handleNormalBackgroundImport();
    }

    setError("");
    setScrapedProduct(null);
    setDuplicateProduct(null);
    setQueueProgress(0);
    setQueueDetail("");

    const validationError = getAddProductUrlValidationError(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    try {
      const data = await runQueuedAmazonImport<ScrapedProduct>({
        url: url.trim(),
        mode: "advanced",
      }, {
        signal: AbortSignal.timeout(150_000),
        onProgress: (progress) => {
          setQueueProgress(progress.progress);
          setQueueDetail(getAmazonImportStageMessage(progress.stage));
        },
      });

      if (!data.title || !Array.isArray(data.images) || !data.asin) {
        setError("Amazon scraping returned an incomplete product. Please try again.");
        return;
      }

      const hasRegular = Boolean(data.priceChoices?.regular);
      const hasDeal = Boolean(data.priceChoices?.deal);
      if (!hasRegular && !hasDeal) {
        setError(
          "Amazon product was found, but ListFlow could not read a regular or deal buybox price. No draft was created.",
        );
        return;
      }

      setSelectedMode(hasRegular ? "REGULAR" : "DEAL");
      setScrapedProduct(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setDuplicateProduct(
        error instanceof AmazonImportRequestError ? error.existing ?? null : null,
      );
      setError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Amazon is taking too long to respond. No draft was created."
          : /unexpected token|not valid json/i.test(message)
          ? "The server returned an unexpected response while importing. Please try again after redeploying the latest ListFlow fix."
          : message
          ? message
          : "Request timed out or failed. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleNormalBackgroundImport() {
    setError("");
    setScrapedProduct(null);
    setDuplicateProduct(null);

    const validationError = getAddProductUrlValidationError(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    const importUrl = url.trim();
    setUrl("");
    setSelectedMode(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
    onBackgroundStarted?.(importUrl);
    onClose();

    try {
      const data = await runQueuedAmazonImport<ScrapedProduct>({
        url: importUrl,
      }, {
        signal: AbortSignal.timeout(150_000),
        onProgress: onBackgroundProgress,
      });

      if (!data.title || !Array.isArray(data.images) || !data.asin) {
        onBackgroundFailed?.(
          "Amazon scraping returned an incomplete product. Please try again.",
        );
        return;
      }

      const regular = data.priceChoices?.regular ?? null;

      if (!regular) {
        onBackgroundFailed?.(
          "Regular Amazon price was not available. Use Advanced Upload to choose another available price.",
        );
        return;
      }

      await onScraped(
        {
          ...data,
          price: regular.price,
          amazonPriceTrackingMode: "REGULAR",
        },
        { background: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      onBackgroundFailed?.(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Amazon is taking too long to respond. No draft was created."
          : /unexpected token|not valid json/i.test(message)
            ? "The server returned an unexpected response while importing. Please try again after redeploying the latest ListFlow fix."
            : message
              ? message
              : "Request timed out or failed. Please try again.",
        error instanceof DuplicateDraftError
          ? error.existing
          : error instanceof AmazonImportRequestError
            ? error.existing
            : undefined,
      );
    }
  }

  async function handleCreateDraft() {
    if (!scrapedProduct) {
      return;
    }

    const choice = selectedMode === "DEAL" ? dealChoice : regularChoice;
    if (!choice) {
      setError(
        `${getAmazonPriceTrackingLabel(selectedMode)} is not available for this Amazon product.`
      );
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      await onScraped(
        {
          ...scrapedProduct,
          price: choice.price,
          amazonPriceTrackingMode: selectedMode,
        },
        { background: false },
      );
      setUrl("");
      setScrapedProduct(null);
      setSelectedMode(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
    } catch (error) {
      setDuplicateProduct(
        error instanceof DuplicateDraftError ? error.existing : null,
      );
      setError(error instanceof Error ? error.message : "Failed to create draft.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-950/50 backdrop-blur-[1px]"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
        >
          <div className="border-b border-gray-100 py-4 pl-5 pr-16 sm:pl-6 sm:pr-20">
            <div>
              <h2 id={titleId} className="text-lg font-bold text-gray-950">
                {isAdvancedMode ? "Advanced Upload" : "Normal Upload"}
              </h2>
              <p id={descriptionId} className="mt-1 text-sm leading-5 text-gray-500">
                {isAdvancedMode
                  ? "Choose which Amazon price ListFlow should track."
                  : "Tracks the regular Amazon price and creates the draft in the background."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={isLoading}
              className="absolute right-3 top-3 z-10 min-h-10 w-10 px-0 sm:right-4 sm:top-4"
              aria-label="Close upload dialog"
              icon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              }
            >
              <span className="sr-only">Close</span>
            </Button>
          </div>

          <div className="overflow-y-auto px-5 py-5 sm:px-6">

          <input
            ref={urlInputRef}
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setScrapedProduct(null);
              setDuplicateProduct(null);
              setError("");
            }}
            placeholder="https://www.amazon.com.au/dp/..."
            disabled={isLoading}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${descriptionId}-error` : undefined}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading) {
                if (scrapedProduct) {
                  handleCreateDraft();
                } else {
                  handleImport();
                }
              }
            }}
          />

          {isAdvancedMode && scrapedProduct && (
            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-900 line-clamp-2">
                  {scrapedProduct.title}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  ASIN {scrapedProduct.asin}
                </p>
              </div>

              <div className="space-y-2">
                {regularChoice && (
                  <label className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">
                        {regularChoice.label}
                      </span>
                      <span className="ml-2 text-gray-700">
                        A${regularChoice.price.toFixed(2)}
                      </span>
                    </span>
                    <input
                      type="radio"
                      checked={selectedMode === "REGULAR"}
                      onChange={() => setSelectedMode("REGULAR")}
                    />
                  </label>
                )}

                {dealChoice && (
                  <label className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">
                        {dealChoice.label}
                      </span>
                      <span className="ml-2 text-gray-700">
                        A${dealChoice.price.toFixed(2)}
                      </span>
                    </span>
                    <input
                      type="radio"
                      checked={selectedMode === "DEAL"}
                      onChange={() => setSelectedMode("DEAL")}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              id={`${descriptionId}-error`}
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              <p>{error}</p>
              {duplicateProduct && onOpenExisting && (
                <button
                  type="button"
                  onClick={() => onOpenExisting(duplicateProduct)}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  Open existing product
                </button>
              )}
            </div>
          )}

          <div className="mt-6">
            {isLoading ? (
              <div className="w-full rounded-xl border border-orange-100 bg-orange-50/60 px-4 py-3">
                <ActionProgressBar
                  label={
                    scrapedProduct
                      ? "Saving draft"
                      : "Reading Amazon"
                  }
                  percent={queueProgress > 0 ? queueProgress : importProgress}
                  detail={
                    scrapedProduct
                      ? "Saving the selected Amazon price mode."
                      : queueDetail || "Waiting for the Amazon import worker."
                  }
                  tone="orange"
                />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  onClick={handleClose}
                  variant="secondary"
                  size="md"
                  fullWidth
                >
                  Cancel
                </Button>
                <Button
                  onClick={scrapedProduct ? handleCreateDraft : handleImport}
                  disabled={Boolean(scrapedProduct && !selectedChoice)}
                  variant="primary"
                  size="md"
                  fullWidth
                >
                  {scrapedProduct ? "Create Draft" : "Import Product"}
                </Button>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
