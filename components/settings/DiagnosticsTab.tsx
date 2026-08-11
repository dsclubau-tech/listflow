"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AsinLink from "@/components/AsinLink";
import type { LogEntry } from "@/lib/logging";

type LogsResponse = {
  storage: "database" | "file-fallback";
  entries: LogEntry[];
  warning?: string;
};

const levelOptions = [
  { label: "Errors", value: "ERROR,CRITICAL" },
  { label: "All levels", value: "" },
  { label: "Warnings", value: "WARN" },
  { label: "Info", value: "INFO" },
  { label: "Debug", value: "DEBUG" },
  { label: "eBay responses", value: "EBAY_RESPONSE" },
];

const sourceOptions = [
  { label: "All sources", value: "" },
  { label: "Server", value: "server" },
  { label: "Client", value: "client" },
  { label: "Worker", value: "worker" },
  { label: "Proxy", value: "proxy" },
];

const timeOptions = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" },
];

function sinceForRange(range: string) {
  if (range === "all") return "";

  const date = new Date();
  if (range === "24h") date.setHours(date.getHours() - 24);
  if (range === "7d") date.setDate(date.getDate() - 7);
  if (range === "30d") date.setDate(date.getDate() - 30);
  return date.toISOString();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function levelClass(level: string) {
  if (level === "CRITICAL" || level === "ERROR") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  if (level === "WARN") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (level === "EBAY_RESPONSE") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  return "bg-gray-50 text-gray-700 border-gray-200";
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function buildDebugBundle(entry: LogEntry) {
  return JSON.stringify(
    {
      errorId: shortId(entry.id),
      id: entry.id,
      timestamp: entry.timestamp,
      level: entry.level,
      source: entry.source,
      runtime: entry.runtime,
      environment: entry.environment,
      context: entry.context,
      message: entry.message,
      fingerprint: entry.fingerprint,
      requestId: entry.requestId,
      storeId: entry.storeId,
      workerId: entry.workerId,
      workerName: entry.workerName,
      jobType: entry.jobType,
      jobId: entry.jobId,
      productId: entry.productId,
      variantId: entry.variantId,
      ebayItemId: entry.ebayItemId,
      asin: entry.asin,
      route: entry.route ?? entry.pathname,
      method: entry.method,
      tags: entry.tags,
      error: entry.error,
      data: entry.data,
    },
    null,
    2,
  );
}

export default function DiagnosticsTab() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState("ERROR,CRITICAL");
  const [source, setSource] = useState("");
  const [timeRange, setTimeRange] = useState("24h");
  const [search, setSearch] = useState("");
  const [storage, setStorage] = useState<LogsResponse["storage"]>("database");
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  );

  const counts = useMemo(() => {
    return entries.reduce(
      (current, entry) => {
        if (entry.level === "CRITICAL" || entry.level === "ERROR") {
          current.errors += 1;
        } else if (entry.level === "WARN") {
          current.warnings += 1;
        } else {
          current.other += 1;
        }
        return current;
      },
      { errors: 0, warnings: 0, other: 0 },
    );
  }, [entries]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    const params = new URLSearchParams({
      limit: "200",
    });
    if (level) params.set("level", level);
    if (source) params.set("source", source);
    if (search.trim()) params.set("search", search.trim());
    const since = sinceForRange(timeRange);
    if (since) params.set("since", since);

    try {
      const response = await fetch(`/api/logs?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as LogsResponse | null;

      if (!response.ok || !data) {
        setError(
          data && "warning" in data
            ? data.warning ?? "Failed to load diagnostics logs."
            : "Failed to load diagnostics logs.",
        );
        return;
      }

      setEntries(data.entries);
      setStorage(data.storage);
      setWarning(data.warning ?? null);
      setSelectedId((current) =>
        current && data.entries.some((entry) => entry.id === current)
          ? current
          : data.entries[0]?.id ?? null,
      );
    } catch {
      setError("Network error while loading diagnostics logs.");
    } finally {
      setLoading(false);
    }
  }, [level, search, source, timeRange]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  async function copyBundle(entry: LogEntry | null) {
    if (!entry) return;

    try {
      await navigator.clipboard.writeText(buildDebugBundle(entry));
      setNotice(`Copied debug bundle ${shortId(entry.id)}.`);
    } catch {
      setError("Could not copy debug bundle.");
    }
  }

  async function clearLogs() {
    const confirmed = window.confirm(
      "Clear diagnostics logs for the current store? This does not delete products, jobs, or upload history.",
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/logs", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || "Failed to clear diagnostics logs.");
        return;
      }
      setNotice(`Cleared ${data?.deleted ?? 0} log record(s).`);
      await fetchLogs();
    } catch {
      setError("Network error while clearing diagnostics logs.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Diagnostics</h2>
            <p className="mt-1 text-sm text-gray-500">
              Search store-scoped errors, worker events, job traces, and browser crashes.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void fetchLogs()}
              disabled={loading}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void clearLogs()}
              disabled={loading}
              className="rounded-md border border-quaternary px-3 py-2 text-sm font-medium text-quaternary hover:bg-quaternary-soft disabled:opacity-50"
            >
              Clear logs
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-3 lg:grid-cols-[180px_160px_160px_1fr]">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {levelOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {sourceOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={timeRange}
              onChange={(event) => setTimeRange(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {timeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search error ID, product ID, eBay ID, job ID, route, message..."
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase text-gray-500">Results</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{entries.length}</p>
            </div>
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs font-medium uppercase text-red-600">Errors</p>
              <p className="mt-1 text-2xl font-semibold text-red-700">{counts.errors}</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-medium uppercase text-amber-600">Warnings</p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">
                {counts.warnings}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase text-gray-500">Storage</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{storage}</p>
            </div>
          </div>

          {warning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {warning}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {notice}
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2">Context</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">IDs</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-gray-500" colSpan={6}>
                      Loading diagnostics...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-gray-500" colSpan={6}>
                      No matching logs found.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={
                        selectedEntry?.id === entry.id
                          ? "bg-orange-50"
                          : "hover:bg-gray-50"
                      }
                    >
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                        {formatDate(entry.timestamp)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${levelClass(entry.level)}`}
                        >
                          {entry.level}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 font-medium text-gray-900">
                        <div className="truncate">{entry.context}</div>
                        <div className="text-xs font-normal text-gray-500">
                          {entry.source} / {entry.runtime}
                        </div>
                      </td>
                      <td className="max-w-[380px] px-3 py-3 text-gray-700">
                        <div className="truncate">{entry.message}</div>
                        {entry.error?.message && (
                          <div className="truncate text-xs text-red-600">
                            {entry.error.message}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        <div>Error {shortId(entry.id)}</div>
                        {entry.jobId && <div>Job {entry.jobId.slice(0, 8)}</div>}
                        {entry.productId && (
                          <div>Product {entry.productId.slice(0, 8)}</div>
                        )}
                        {entry.asin && (
                          <div>
                            ASIN{" "}
                            <AsinLink
                              asin={entry.asin}
                              className="font-mono text-xs text-orange-600 hover:text-orange-800 hover:underline"
                            />
                          </div>
                        )}
                        {entry.ebayItemId && <div>eBay {entry.ebayItemId}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(entry.id)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedEntry && (
            <div className="rounded-lg border border-gray-200 bg-gray-50">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Error ID {shortId(selectedEntry.id)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedEntry.context} / {selectedEntry.fingerprint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyBundle(selectedEntry)}
                  className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
                >
                  Copy debug bundle
                </button>
              </div>
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium text-gray-700">Message:</span>{" "}
                    {selectedEntry.message}
                  </p>
                  {selectedEntry.error?.message && (
                    <p>
                      <span className="font-medium text-gray-700">Error:</span>{" "}
                      {selectedEntry.error.name ? `${selectedEntry.error.name}: ` : ""}
                      {selectedEntry.error.message}
                    </p>
                  )}
                  <p>
                    <span className="font-medium text-gray-700">Route:</span>{" "}
                    {selectedEntry.method ? `${selectedEntry.method} ` : ""}
                    {selectedEntry.route ?? selectedEntry.pathname ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">Worker:</span>{" "}
                    {selectedEntry.workerName ?? selectedEntry.workerId ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">Job:</span>{" "}
                    {selectedEntry.jobType ?? "-"} {selectedEntry.jobId ?? ""}
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">Product:</span>{" "}
                    {selectedEntry.productId ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">ASIN:</span>{" "}
                    <AsinLink
                      asin={selectedEntry.asin}
                      className="font-mono text-xs text-orange-600 hover:text-orange-800 hover:underline"
                    />
                  </p>
                </div>
                <pre className="max-h-80 overflow-auto rounded-md bg-white p-3 text-xs text-gray-700">
                  {buildDebugBundle(selectedEntry)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
