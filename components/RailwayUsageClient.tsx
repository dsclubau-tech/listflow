"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  HeartbeatState,
  InfrastructureState,
  RailwayUsageReport,
} from "@/lib/railway-api";

interface RailwayUsageClientProps {
  initialReport?: RailwayUsageReport | null;
}

const AUTO_REFRESH_MS = 5 * 60 * 1000;

function money(value: number | null, approximate = false) {
  if (value === null) return "Unavailable";
  return `${approximate ? "~" : ""}$${value.toFixed(2)}`;
}

function dateLabel(value: string | null, includeTime = false) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return date.toLocaleString([], includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" });
}

function InfrastructureBadge({ state }: { state: InfrastructureState }) {
  const styles = {
    online: "border-emerald-200 bg-emerald-50 text-emerald-800",
    starting: "border-blue-200 bg-blue-50 text-blue-800",
    offline: "border-red-200 bg-red-50 text-red-800",
    unknown: "border-gray-200 bg-gray-50 text-gray-700",
  }[state];
  const label = {
    online: "Railway Online",
    starting: "Railway Starting",
    offline: "Railway Offline",
    unknown: "Railway Unknown",
  }[state];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      {label}
    </span>
  );
}

function HeartbeatBadge({ state }: { state: HeartbeatState }) {
  const styles = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
    stale: "border-amber-200 bg-amber-50 text-amber-800",
    missing: "border-gray-200 bg-gray-50 text-gray-700",
  }[state];
  const label = {
    healthy: "Heartbeat healthy",
    stale: "Heartbeat stale",
    missing: "Heartbeat missing",
  }[state];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

function Card({
  label,
  value,
  detail,
  tone = "text-gray-900",
}: {
  label: string;
  value: string;
  detail: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${tone}`}>{value}</p>
      <div className="mt-3 text-xs leading-relaxed text-gray-500">{detail}</div>
    </div>
  );
}

export default function RailwayUsageClient({
  initialReport = null,
}: RailwayUsageClientProps) {
  const [report, setReport] = useState<RailwayUsageReport | null>(initialReport);
  const [isLoading, setIsLoading] = useState(!initialReport);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(
    initialReport?.error ?? null,
  );

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/railway/usage", { cache: "no-store" });
      if (!response.ok) throw new Error(`Railway report request failed (${response.status}).`);
      const nextReport = (await response.json()) as RailwayUsageReport;
      setReport(nextReport);
      setRequestError(nextReport.error ?? null);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Failed to load Railway usage.",
      );
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!report) void refreshData();
  }, [refreshData, report]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshData(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshData]);

  if (isLoading || !report) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8" aria-busy="true">
        <div className="h-20 animate-pulse rounded-xl bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  const { estimate, period, credit, reconciliation, services, workerTelemetry } = report;
  const periodProgress = period.totalSeconds > 0
    ? Math.min(100, Math.round((period.elapsedSeconds / period.totalSeconds) * 100))
    : 0;
  const reconciliationLabel = reconciliation.status === "matches"
    ? "Estimate matches Railway"
    : reconciliation.status === "differs"
      ? "Estimate differs"
      : "Railway comparison unavailable";
  const reconciliationTone = reconciliation.status === "matches"
    ? "text-emerald-700"
    : reconciliation.status === "differs"
      ? "text-red-700"
      : "text-gray-700";
  const specialistCount = services.filter(
    (service) => service.workerRole === "store-specific",
  ).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Railway Usage & Costs</h1>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
              report.configured
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}>
              {report.configured ? "Live Railway Sync" : "Railway not configured"}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {report.infrastructureOnlineCount}/{services.length} Railway online · {report.heartbeatHealthyCount}/{services.length} heartbeat healthy
            {report.parkedServicesCount > 0 ? ` · ${report.parkedServicesCount} intentionally parked` : ""}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Snapshot fetched {dateLabel(report.lastUpdated, true)} · methodology {estimate.methodologyVersion}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Auto-refresh (5m)
          </label>
          <button
            type="button"
            onClick={() => void refreshData()}
            disabled={isRefreshing}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {(requestError || report.warnings.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          {requestError ? <p className="font-semibold">{requestError}</p> : null}
          {report.warnings.map((warning) => (
            <p key={warning} className="mt-1 text-xs text-amber-800">{warning}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          label="Estimated Worker Compute Cost"
          value={money(estimate.currentGrossCost)}
          tone="text-blue-700"
          detail={
            <div>
              <div className="flex justify-between gap-3">
                <span>{dateLabel(period.start)} – {dateLabel(period.end)}</span>
                <span>{periodProgress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${periodProgress}%` }} />
              </div>
              <p className="mt-2 capitalize">{period.type} / billing period · gross project usage</p>
            </div>
          }
        />
        <Card
          label="Projected Period-End"
          value={money(estimate.projectedGrossCost, true)}
          detail={estimate.recentBurnPerDay === null
            ? "Unavailable until a complete burn-rate window exists."
            : `Latest available 24-hour burn: ~$${estimate.recentBurnPerDay.toFixed(2)} per day.`}
        />
        <Card
          label="Railway Credit Available"
          value={credit.availableUsd === null ? "Unavailable" : money(credit.availableUsd)}
          tone="text-emerald-700"
          detail={credit.source === "unavailable" ? (
            <span>
              Railway’s accessible API does not expose the live workspace credit balance.{" "}
              {credit.dashboardUrl ? (
                <a className="font-semibold text-blue-700 underline" href={credit.dashboardUrl} target="_blank" rel="noreferrer">Open Railway</a>
              ) : null}
            </span>
          ) : `Railway workspace value fetched ${dateLabel(credit.fetchedAt, true)}.`}
        />
        <Card
          label="Credit Expires"
          value={dateLabel(credit.expiresAt)}
          detail={`Credit is workspace-wide and is never calculated as $5 minus this project’s usage. Snapshot: ${dateLabel(credit.fetchedAt, true)}.`}
        />
        <Card
          label="Worker Coverage"
          value={`${report.infrastructureOnlineCount}/${services.length} online`}
          tone="text-blue-700"
          detail={`${report.heartbeatHealthyCount}/${services.length} heartbeat healthy · ${specialistCount} specialist · ${services.filter((service) => service.workerRole === "unified").length} unified.`}
        />
        <Card
          label="Railway Reconciliation"
          value={reconciliationLabel}
          tone={reconciliationTone}
          detail={reconciliation.status === "unavailable"
            ? reconciliation.reason ?? "No comparable Railway project value was available."
            : `Estimate ${money(estimate.currentGrossCost)} · Railway ${money(reconciliation.railwayProjectUsage)} · difference ${money(reconciliation.absoluteDifference)} (tolerance ${money(reconciliation.tolerance)}).`}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-xs">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="font-semibold text-gray-900">Per-Service Resource Breakdown</h2>
          <p className="mt-1 text-xs text-gray-500">
            Railway billable vCPU-minutes, GB-minutes and egress for the exact period above. Deployment and heartbeat states are intentionally separate.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-6 py-3.5">Service</th>
                <th className="px-6 py-3.5">Infrastructure</th>
                <th className="px-6 py-3.5">Application Health</th>
                <th className="px-6 py-3.5">CPU</th>
                <th className="px-6 py-3.5">RAM</th>
                <th className="px-6 py-3.5">Egress</th>
                <th className="px-6 py-3.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {services.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-500">No complete Railway service snapshot is available.</td></tr>
              ) : services.map((service) => (
                <tr key={service.id} className="align-top hover:bg-gray-50/60">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-gray-900">{service.name}</p>
                    <p className="mt-1 max-w-xs text-xs text-gray-500">
                      {service.workerRole === "unified" ? "Unified" : service.workerRole === "store-specific" ? "Store-specific" : "Legacy / unknown"} · {service.coverage}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">{service.activeLeaseCount} active lease{service.activeLeaseCount === 1 ? "" : "s"}</p>
                  </td>
                  <td className="px-6 py-4">
                    <InfrastructureBadge state={service.infrastructureState} />
                    <p className="mt-2 text-xs text-gray-400">Deployment {service.deploymentStatus ?? "unavailable"}</p>
                  </td>
                  <td className="px-6 py-4">
                    <HeartbeatBadge state={service.heartbeatState} />
                    <p className="mt-2 text-xs text-gray-400">Last: {dateLabel(service.lastHeartbeatAt, true)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{service.cpuVcpuMinutes.toFixed(2)} vCPU-min</p>
                    <p className="mt-1 text-xs text-gray-500">${service.cpuCost.toFixed(4)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{service.memoryGbMinutes.toFixed(2)} GB-min</p>
                    <p className="mt-1 text-xs text-purple-700">${service.memoryCost.toFixed(4)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{service.networkEgressGb.toFixed(3)} GB</p>
                    <p className="mt-1 text-xs text-gray-500">${service.networkEgressCost.toFixed(4)}</p>
                  </td>
                  <td className="px-6 py-4 text-right text-base font-bold text-gray-900">${service.totalCost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {services.length > 0 ? (
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <tr>
                  <td className="px-6 py-3.5" colSpan={3}>Total</td>
                  <td className="px-6 py-3.5">{money(estimate.cpuCost)}</td>
                  <td className="px-6 py-3.5 text-purple-700">{money(estimate.memoryCost)}</td>
                  <td className="px-6 py-3.5">{money(estimate.networkEgressCost)}</td>
                  <td className="px-6 py-3.5 text-right text-base text-blue-700">{money(estimate.currentGrossCost)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-xs">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="font-semibold text-gray-900">ListFlow Worker Telemetry</h2>
          <p className="mt-1 text-xs text-gray-500">Application process snapshots; these do not determine Railway deployment status.</p>
        </div>
        <div className="p-6">
          {workerTelemetry.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No internal telemetry snapshots recorded yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {workerTelemetry.slice(0, 6).map((snapshot) => (
                <div key={snapshot.id} className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{snapshot.workerName}</p>
                      <p className="mt-1 text-xs text-gray-400">{snapshot.workerId}</p>
                    </div>
                    <span className="text-xs text-gray-500">{dateLabel(snapshot.timestamp, true)}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-gray-400">RSS RAM</dt><dd className="mt-1 font-semibold">{snapshot.rssMB.toFixed(1)} MB</dd></div>
                    <div><dt className="text-gray-400">CPU</dt><dd className="mt-1 font-semibold">{snapshot.cpuPercent.toFixed(1)}%</dd></div>
                    <div><dt className="text-gray-400">Uptime</dt><dd className="mt-1 font-semibold">{Math.floor(snapshot.uptimeSeconds / 3600)}h</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
