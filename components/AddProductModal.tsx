"use client";

import ActionProgressBar from "@/components/ActionProgressBar";
import { getAddProductUrlValidationError } from "@/components/add-product-validation";
import { useTimedActionProgress } from "@/hooks/useTimedActionProgress";
import {
  DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  getAmazonPriceTrackingLabel,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import { useState } from "react";

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScraped: (data: ScrapedProduct) => void | Promise<void>;
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

type ScrapeResponseBody = Partial<ScrapedProduct> & {
  error?: string;
};

function getFallbackScrapeError(response: Response, bodyText: string) {
  const trimmed = bodyText.trim();

  if (response.status === 504 || response.status === 408) {
    return "Amazon is taking too long to respond. No draft was created.";
  }

  if (response.status >= 500) {
    return "Amazon scraping failed on the server. Please try again after redeploying the latest ListFlow fix.";
  }

  if (trimmed) {
    return trimmed.slice(0, 240);
  }

  return "Scraping failed. Please try again.";
}

async function readScrapeResponse(response: Response) {
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    return {} as ScrapeResponseBody;
  }

  try {
    return JSON.parse(bodyText) as ScrapeResponseBody;
  } catch {
    return {
      error: getFallbackScrapeError(response, bodyText),
    } satisfies ScrapeResponseBody;
  }
}

export default function AddProductModal({
  isOpen,
  onClose,
  onScraped,
}: AddProductModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [scrapedProduct, setScrapedProduct] = useState<ScrapedProduct | null>(
    null
  );
  const [selectedMode, setSelectedMode] =
    useState<AmazonPriceTrackingMode>(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
  const importProgress = useTimedActionProgress(isLoading, {
    initialPercent: 12,
    maxWaitingPercent: 90,
    stepPercent: 8,
  });

  if (!isOpen) return null;

  const regularChoice = scrapedProduct?.priceChoices?.regular ?? null;
  const dealChoice = scrapedProduct?.priceChoices?.deal ?? null;
  const selectedChoice =
    selectedMode === "DEAL" ? dealChoice : regularChoice;

  async function handleImport() {
    setError("");
    setScrapedProduct(null);

    const validationError = getAddProductUrlValidationError(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: AbortSignal.timeout(45000), // 45s timeout for direct Amazon import
      });

      const data = await readScrapeResponse(res);

      if (res.ok) {
        if (!data.title || !Array.isArray(data.images) || !data.asin) {
          setError("Amazon scraping returned an incomplete product. Please try again.");
          return;
        }

        const scraped = data as ScrapedProduct;
        const hasRegular = Boolean(scraped.priceChoices?.regular);
        const hasDeal = Boolean(scraped.priceChoices?.deal);

        if (!hasRegular && !hasDeal) {
          setError(
            "Amazon product was found, but ListFlow could not read a regular or deal buybox price. No draft was created."
          );
          return;
        }

        setSelectedMode(hasRegular ? "REGULAR" : "DEAL");
        setScrapedProduct(scraped);
      } else {
        setError(data.error || "Scraping failed. Please try again.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
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
      await onScraped({
        ...scrapedProduct,
        price: choice.price,
        amazonPriceTrackingMode: selectedMode,
      });
      setUrl("");
      setScrapedProduct(null);
      setSelectedMode(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create draft.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    if (!isLoading) {
      setUrl("");
      setError("");
      setScrapedProduct(null);
      setSelectedMode(DEFAULT_AMAZON_PRICE_TRACKING_MODE);
      onClose();
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Add Product
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Paste an Amazon AU product URL to import
          </p>

          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setScrapedProduct(null);
              setError("");
            }}
            placeholder="https://www.amazon.com.au/dp/..."
            disabled={isLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 disabled:opacity-50"
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

          {scrapedProduct && (
            <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4">
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
                  <label className="flex cursor-pointer items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">
                        Regular price
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
                  <label className="flex cursor-pointer items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">
                        Deal price
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
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}

          <div className="flex items-center gap-3 mt-6">
            {isLoading ? (
              <div className="w-full px-1 py-2">
                <ActionProgressBar
                  label={
                    scrapedProduct
                      ? "Creating draft"
                      : "Importing from Amazon"
                  }
                  percent={importProgress}
                  detail={
                    scrapedProduct
                      ? "Saving the selected Amazon price mode."
                      : "Fetching the selected product and reading the buy-box prices."
                  }
                  tone="orange"
                />
              </div>
            ) : (
              <>
                <button
                  onClick={scrapedProduct ? handleCreateDraft : handleImport}
                  disabled={Boolean(scrapedProduct && !selectedChoice)}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
                >
                  {scrapedProduct ? "Create Draft" : "Import Product"}
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
