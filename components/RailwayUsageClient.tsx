"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import type { RailwayUsageReport } from "@/lib/railway-api";

interface RailwayUsageClientProps {
  initialReport?: RailwayUsageReport | null;
}

export default function RailwayUsageClient({ initialReport = null }: RailwayUsageClientProps) {
  const [report, setReport] = useState<RailwayUsageReport | null>(initialReport);
  const [isRefreshing, startRefreshing] = useTransition();
  const [isLoading, setIsLoading] = useState(!initialReport);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(initialReport?.error ?? null);

  const refreshData = useCallback(() => {
    startRefreshing(async () => {
      try {
        const res = await fetch("/api/railway/usage", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        const data: RailwayUsageReport = await res.json();
        setReport(data);
        setError(data.error ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch Railway usage data");
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  // Fetch on mount if no initial report
  useEffect(() => {
    if (!report) {
      refreshData();
    }
  }, [report, refreshData]);

  // Periodic polling every 30 seconds when autoRefresh is active
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshData();
    }, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshData]);

  if (isLoading || !report) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="flex items-center justify-between border-b border-gray-200 pb-5">
          <div className="space-y-2">
            <div className="h-7 bg-gray-200 rounded-md w-64" />
            <div className="h-4 bg-gray-200 rounded-md w-96" />
          </div>
          <div className="h-9 bg-gray-200 rounded-lg w-28" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 h-36" />
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6 h-64" />
      </div>
    );
  }

  const { billingPeriod, services, workerTelemetry } = report;
  const currentCost = billingPeriod.currentPeriodCost;
  const projectedCost = billingPeriod.projectedMonthEndCost;
  const dailyAverage = billingPeriod.dailyAverageCost;

  // Calculate memory cost vs total
  const totalMemoryCost = services.reduce((sum, s) => sum + s.memoryCost, 0);
  const totalCpuCost = services.reduce((sum, s) => sum + s.cpuCost, 0);
  const totalEgressCost = services.reduce((sum, s) => sum + s.networkEgressCost, 0);

  const memoryCostPercentage =
    currentCost > 0 ? Math.round((totalMemoryCost / currentCost) * 100) : 90;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Railway Usage & Costs
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                report.configured
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  : "bg-amber-100 text-amber-800 border border-amber-200"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  report.configured ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                }`}
              />
              {report.configured ? "Live Railway Sync" : "Internal Telemetry Only"}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Real-time infrastructure billing calculation, resource allocation, and worker process health.
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            Auto-refresh (30s)
          </label>

          <button
            type="button"
            onClick={refreshData}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 shadow-xs active:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <svg
              className={`w-4 h-4 text-gray-500 ${isRefreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Notice / Warning banner if any */}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Notice</p>
            <p className="mt-0.5 text-xs text-amber-700 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Month to Date Spend */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs hover:border-gray-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Month-to-Date Spend
            </span>
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 tracking-tight">
              ${currentCost.toFixed(2)}
            </span>
            <span className="text-xs text-gray-500 font-medium">USD</span>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Day {billingPeriod.daysElapsed} of {billingPeriod.totalDaysInMonth}</span>
              <span>{Math.round((billingPeriod.daysElapsed / billingPeriod.totalDaysInMonth) * 100)}% of cycle</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-1.5 rounded-full"
                style={{
                  width: `${Math.min(
                    Math.round((billingPeriod.daysElapsed / billingPeriod.totalDaysInMonth) * 100),
                    100
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Projected Month-End */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs hover:border-gray-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Projected Month-End
            </span>
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 tracking-tight">
              ~${projectedCost.toFixed(2)}
            </span>
            <span className="text-xs text-gray-500 font-medium">USD</span>
          </div>
          <div className="mt-3 text-xs text-gray-500 flex items-center justify-between">
            <span>Daily Burn Rate</span>
            <span className="font-semibold text-gray-900">${dailyAverage.toFixed(2)} / day</span>
          </div>
        </div>

        {/* Memory Cost (RAM) */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs hover:border-gray-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Memory Cost (RAM)
            </span>
            <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600 font-semibold text-xs">
              {memoryCostPercentage}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 tracking-tight">
              ${totalMemoryCost.toFixed(2)}
            </span>
            <span className="text-xs text-gray-500 font-medium">@ $10/GB-mo</span>
          </div>
          <div className="mt-3 text-xs text-gray-500 flex items-center justify-between">
            <span>Total RAM Billed</span>
            <span className="font-medium text-gray-700">
              {services.reduce((acc, s) => acc + s.memoryGBHours, 0).toFixed(0)} GB-hrs
            </span>
          </div>
        </div>

        {/* CPU & Egress */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs hover:border-gray-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              CPU & Egress
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 tracking-tight">
              ${(totalCpuCost + totalEgressCost).toFixed(2)}
            </span>
            <span className="text-xs text-gray-500 font-medium">USD</span>
          </div>
          <div className="mt-3 text-xs text-gray-500 flex items-center justify-between">
            <span>vCPU-hours / Egress</span>
            <span className="font-medium text-gray-700">
              {services.reduce((acc, s) => acc + s.cpuHours, 0).toFixed(1)} vCPU ·{" "}
              {services.reduce((acc, s) => acc + s.networkEgressGB, 0).toFixed(2)} GB
            </span>
          </div>
        </div>
      </div>

      {/* Services Usage Breakdown Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Per-Service Cost Breakdown</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Accumulated resource metrics for each worker container in your Railway project.
            </p>
          </div>
          <span className="text-xs text-gray-400">
            {services.length} active service{services.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/75 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Service Name</th>
                <th className="px-6 py-3.5">CPU Usage</th>
                <th className="px-6 py-3.5">Memory (RAM)</th>
                <th className="px-6 py-3.5">Network Egress</th>
                <th className="px-6 py-3.5">Current Cost</th>
                <th className="px-6 py-3.5 text-right">% Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {services.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500 text-sm">
                    No Railway service data available. Check that your Railway API token and Project ID are set.
                  </td>
                </tr>
              ) : (
                services.map((service) => {
                  const share =
                    currentCost > 0 ? Math.round((service.totalCost / currentCost) * 100) : 0;

                  return (
                    <tr key={service.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        <div>
                          <div className="font-semibold text-gray-900">{service.name}</div>
                          <div className="text-xs text-gray-400 font-mono mt-0.5 truncate max-w-xs">
                            {service.id}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        <div className="font-medium text-gray-900">{service.cpuHours.toFixed(1)} vCPU-hrs</div>
                        <div className="text-xs text-gray-500 font-mono">${service.cpuCost.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        <div className="font-medium text-gray-900">{service.memoryGBHours.toFixed(1)} GB-hrs</div>
                        <div className="text-xs text-purple-700 font-mono font-medium">
                          ${service.memoryCost.toFixed(2)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        <div className="font-medium text-gray-900">{service.networkEgressGB.toFixed(3)} GB</div>
                        <div className="text-xs text-gray-500 font-mono">${service.networkEgressCost.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-900">
                        ${service.totalCost.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700">{share}%</span>
                          <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {services.length > 0 && (
              <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-300 text-gray-900">
                <tr>
                  <td className="px-6 py-3.5">Total</td>
                  <td className="px-6 py-3.5 font-mono">${totalCpuCost.toFixed(2)}</td>
                  <td className="px-6 py-3.5 font-mono text-purple-700">${totalMemoryCost.toFixed(2)}</td>
                  <td className="px-6 py-3.5 font-mono">${totalEgressCost.toFixed(2)}</td>
                  <td className="px-6 py-3.5 font-mono text-blue-700 text-base">
                    ${currentCost.toFixed(2)}
                  </td>
                  <td className="px-6 py-3.5 text-right">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Live Worker Internal Telemetry Snapshots */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Worker Process Telemetry (RAM & CPU)</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Live snapshots reported directly from the worker processes via internal telemetry.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Active Emitter
          </span>
        </div>

        <div className="p-6">
          {workerTelemetry.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500">
              <p>No internal telemetry snapshots recorded yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Workers report memory and CPU snapshots every 60 seconds while active.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workerTelemetry.slice(0, 6).map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 hover:bg-white hover:shadow-xs transition-all space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">
                        {snapshot.workerName}
                      </h3>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">{snapshot.workerId}</p>
                    </div>
                    <span className="text-[11px] text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-md">
                      {new Date(snapshot.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* RAM breakdown */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">RSS (Container RAM):</span>
                      <span className="font-semibold text-gray-900 font-mono">
                        {snapshot.rssMB.toFixed(1)} MB
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">V8 Heap Used / Total:</span>
                      <span className="font-medium text-gray-700 font-mono">
                        {snapshot.heapUsedMB.toFixed(1)} / {snapshot.heapTotalMB.toFixed(1)} MB
                      </span>
                    </div>
                    {/* Heap Bar relative to 512MB limit */}
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full ${
                          snapshot.heapUsedMB > 400
                            ? "bg-red-500"
                            : snapshot.heapUsedMB > 250
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${Math.min(Math.round((snapshot.heapUsedMB / 512) * 100), 100)}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>Heap Cap: 512 MB</span>
                      <span>{Math.round((snapshot.heapUsedMB / 512) * 100)}% utilized</span>
                    </div>
                  </div>

                  {/* CPU & Uptime */}
                  <div className="pt-2 border-t border-gray-200 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-400 block text-[10px] uppercase">CPU %</span>
                      <span className="font-semibold text-gray-800 font-mono">
                        {snapshot.cpuPercent.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px] uppercase">Uptime</span>
                      <span className="font-medium text-gray-800 font-mono">
                        {Math.floor(snapshot.uptimeSeconds / 3600)}h{" "}
                        {Math.floor((snapshot.uptimeSeconds % 3600) / 60)}m
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost Optimization Tips Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-blue-600 text-white flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="space-y-1 text-sm">
            <h3 className="font-semibold text-blue-950">Railway Optimization Applied</h3>
            <p className="text-xs text-blue-800 leading-relaxed">
              We added <code className="bg-blue-100 px-1.5 py-0.5 rounded font-mono text-blue-900">--max-old-space-size=512</code> to cap Node.js heap consumption and prevent Out-Of-Memory container kills. Because <strong>90% of your Railway bill is memory usage</strong>, capping each worker to 512MB RAM saves approximately $30–$40 per month across your 3 store workers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
