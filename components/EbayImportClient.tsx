"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface EbayImportClientProps {
  stores: Array<{ id: string; name: string }>;
}

interface ImportProgress {
  page: number;
  totalPages: number;
  created: number;
  skipped: number;
  failed: number;
}

interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ itemId: string; title: string; error: string }>;
}

type ImportStreamEvent =
  | ({ type: "progress" } & ImportProgress)
  | ({ type: "complete" } & ImportResult)
  | { type: "error"; message: string };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function isImportStreamEvent(value: unknown): value is ImportStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  return typeof (value as { type?: unknown }).type === "string";
}

export default function EbayImportClient({ stores }: EbayImportClientProps) {
  const router = useRouter();
  const [selectedStore, setSelectedStore] = useState(stores[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const selectedStoreRecord = stores.find((store) => store.id === selectedStore);
  const progressPercent = progress
    ? Math.min(100, Math.round((progress.page / Math.max(progress.totalPages, 1)) * 100))
    : 0;

  function handleStreamEvent(event: ImportStreamEvent) {
    if (event.type === "progress") {
      setProgress({
        page: event.page,
        totalPages: event.totalPages,
        created: event.created,
        skipped: event.skipped,
        failed: event.failed,
      });
      return;
    }

    if (event.type === "complete") {
      setResult({
        total: event.total,
        created: event.created,
        skipped: event.skipped,
        failed: event.failed,
        errors: event.errors,
      });
      setProgress(null);
      router.refresh();
      return;
    }

    setError(event.message);
  }

  function parseSseBlock(block: string) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));

    if (!dataLine) {
      return null;
    }

    const parsed = JSON.parse(dataLine.slice(6)) as unknown;
    return isImportStreamEvent(parsed) ? parsed : null;
  }

  async function readStream(response: Response) {
    if (!response.body) {
      throw new Error("Import response did not include a stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedTerminalEvent = false;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const event = parseSseBlock(block);

        if (!event) {
          continue;
        }

        handleStreamEvent(event);

        if (event.type === "complete" || event.type === "error") {
          receivedTerminalEvent = true;
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const event = parseSseBlock(buffer);

      if (event) {
        handleStreamEvent(event);
        receivedTerminalEvent = event.type === "complete" || event.type === "error";
      }
    }

    if (!receivedTerminalEvent) {
      throw new Error("Connection lost before the import completed. Re-run the import to continue safely.");
    }
  }

  async function startImport() {
    if (!selectedStore || importing) {
      return;
    }

    const storeName = selectedStoreRecord?.name ?? "the selected store";
    const confirmed = window.confirm(
      `This will import all active eBay listings from ${storeName}. Products already in ListFlow will be skipped. Continue?`,
    );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setProgress(null);
    setResult(null);
    setError(null);
    setShowErrors(false);

    try {
      const response = await fetch("/api/ebay-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to start eBay import");
      }

      await readStream(response);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Import eBay Listings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pull active eBay listings into ListFlow so they can be tracked, revised, and managed with existing products.
        </p>
      </div>

      <div className="space-y-6">
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="store" className="block text-sm font-medium text-gray-700">
                Store
              </label>
              <select
                id="store"
                value={selectedStore}
                onChange={(event) => setSelectedStore(event.target.value)}
                disabled={importing || stores.length === 0}
                className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
              >
                {stores.length === 0 ? (
                  <option value="">No active stores</option>
                ) : (
                  stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              type="button"
              onClick={startImport}
              disabled={importing || !selectedStore}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Importing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0 4-4m-4 4-4-4m-3 8h14" />
                  </svg>
                  Import Active Listings
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </section>

        {importing && (
          <section className="bg-white rounded-lg border border-gray-200 p-6" aria-live="polite">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-gray-900">
                {progress
                  ? `Fetching page ${progress.page} of ${progress.totalPages}...`
                  : "Preparing import..."}
              </p>
              <span className="text-sm text-gray-500">{progressPercent}%</span>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-orange-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-4 grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
              <span>Created: {progress?.created ?? 0}</span>
              <span>Skipped: {progress?.skipped ?? 0}</span>
              <span>Failed: {progress?.failed ?? 0}</span>
            </div>
          </section>
        )}

        {result && (
          <section className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">Import Complete</h2>
              <Link
                href="/products"
                className="text-sm font-medium text-orange-600 transition-colors hover:text-orange-700"
              >
                View Imported Products -&gt;
              </Link>
            </div>

            <dl className="mt-5 grid overflow-hidden rounded-md border border-gray-200 sm:grid-cols-4 sm:divide-x sm:divide-gray-200">
              {[
                ["Total", result.total],
                ["Created", result.created],
                ["Skipped", result.skipped],
                ["Failed", result.failed],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>

            {result.failed > 0 && (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setShowErrors((current) => !current)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  <svg
                    className={`h-4 w-4 transition-transform ${showErrors ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Failed listings ({result.failed})
                </button>

                {showErrors && (
                  <div className="mt-3 overflow-hidden rounded-md border border-gray-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Item ID</th>
                          <th className="px-4 py-3">Title</th>
                          <th className="px-4 py-3">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {result.errors.map((row) => (
                          <tr key={`${row.itemId}-${row.title}`}>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                              {row.itemId}
                            </td>
                            <td className="max-w-xs px-4 py-3 text-gray-700">
                              <span className="block truncate" title={row.title}>
                                {row.title}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-red-700">{row.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
