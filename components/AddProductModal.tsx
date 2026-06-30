"use client";

import { useState } from "react";

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScraped: (data: ScrapedProduct) => void | Promise<void>;
}

export interface ScrapedProduct {
  title: string;
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
  };
}

type ScrapeResponseBody = Partial<ScrapedProduct> & {
  error?: string;
};

function getFallbackScrapeError(response: Response, bodyText: string) {
  const trimmed = bodyText.trim();

  if (response.status === 504 || response.status === 408) {
    return "Amazon scraping timed out. Please try again, or use a direct /dp/ Amazon AU product URL.";
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

  if (!isOpen) return null;

  async function handleImport() {
    setError("");

    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    if (!url.startsWith("https://www.amazon.com.au")) {
      setError("Only Amazon AU (amazon.com.au) URLs are supported");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: AbortSignal.timeout(90000), // 90s timeout for scraping
      });

      const data = await readScrapeResponse(res);

      if (res.ok) {
        if (!data.title || !Array.isArray(data.images) || !data.asin) {
          setError("Amazon scraping returned an incomplete product. Please try again.");
          return;
        }

        setUrl("");
        await onScraped(data as ScrapedProduct);
      } else {
        setError(data.error || "Scraping failed. Please try again.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Amazon scraping timed out. Please try again, or use a direct /dp/ Amazon AU product URL."
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

  function handleClose() {
    if (!isLoading) {
      setUrl("");
      setError("");
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
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.amazon.com.au/dp/..."
            disabled={isLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-gray-800 disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading) handleImport();
            }}
          />

          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}

          <div className="flex items-center gap-3 mt-6">
            {isLoading ? (
              <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600">
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Scraping Amazon and saving draft… this may take 20–30 seconds
              </div>
            ) : (
              <>
                <button
                  onClick={handleImport}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
                >
                  Import Product
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
