import "server-only";

export const RAILWAY_PRICING = {
  methodologyVersion: "railway-billable-minutes-v2",
  minutesPerMonth: 43_200,
  cpuPerVcpuMonthUsd: 20,
  memoryPerGbMonthUsd: 10,
  networkEgressPerGbUsd: 0.05,
} as const;

export type RailwayPlanType = "trial" | "free" | "hobby" | "pro" | "unknown";
export type EstimateCompleteness = "complete" | "partial" | "unavailable";
export type InfrastructureState = "online" | "starting" | "offline" | "unknown";
export type HeartbeatState = "healthy" | "stale" | "missing";

export interface RailwayMetricTotals {
  cpuVcpuMinutes: number;
  memoryGbMinutes: number;
  networkEgressGb: number;
}

export interface RailwayServiceUsage extends RailwayMetricTotals {
  id: string;
  name: string;
  cpuCost: number;
  memoryCost: number;
  networkEgressCost: number;
  totalCost: number;
  infrastructureState: InfrastructureState;
  deploymentStatus: string | null;
  heartbeatState: HeartbeatState;
  lastHeartbeatAt: string | null;
  isParked: boolean;
  workerRole: "unified" | "store-specific" | "legacy" | null;
  coverage: string;
  activeLeaseCount: number;
}

export interface WorkerTelemetrySnapshot {
  id: string;
  workerId: string;
  workerName: string;
  timestamp: string;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuPercent: number;
  uptimeSeconds: number;
  jobsProcessed: number;
}

export interface RailwayReportingPeriod {
  start: string | null;
  end: string | null;
  source: "railway.workspace.customer.billingPeriod" | "unavailable";
  elapsedSeconds: number;
  totalSeconds: number;
  type: RailwayPlanType;
}

export interface RailwayReconciliation {
  status: "matches" | "differs" | "unavailable";
  railwayProjectUsage: number | null;
  absoluteDifference: number | null;
  percentageDifference: number | null;
  tolerance: number | null;
  scope: "workspace-single-project" | "unavailable";
  reason: string | null;
}

export interface RailwayUsageReport {
  configured: boolean;
  projectName: string | null;
  projectId: string | null;
  workspaceId: string | null;
  period: RailwayReportingPeriod;
  estimate: {
    currentGrossCost: number | null;
    projectedGrossCost: number | null;
    recentBurnPerDay: number | null;
    cpuCost: number | null;
    memoryCost: number | null;
    networkEgressCost: number | null;
    completeness: EstimateCompleteness;
    missingMeasurements: string[];
    methodologyVersion: string;
  };
  credit: {
    source: "railway" | "unavailable";
    availableUsd: number | null;
    expiresAt: string | null;
    plan: RailwayPlanType;
    fetchedAt: string;
    dashboardUrl: string | null;
  };
  reconciliation: RailwayReconciliation;
  services: RailwayServiceUsage[];
  infrastructureOnlineCount: number;
  infrastructureKnownCount: number;
  heartbeatHealthyCount: number;
  parkedServicesCount: number;
  workerTelemetry: WorkerTelemetrySnapshot[];
  lastUpdated: string;
  warnings: string[];
  error?: string | null;
}

export interface AveragedMetricSample {
  timestamp: string | Date;
  value: number;
}

const REQUIRED_MEASUREMENTS = [
  "CPU_USAGE",
  "MEMORY_USAGE_GB",
  "NETWORK_TX_GB",
] as const;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HEARTBEAT_HEALTHY_MS = 3 * 60 * 1000;
const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";

function round(value: number, decimals = 4) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function calculateServiceCost(
  cpuVcpuMinutes: number,
  memoryGbMinutes: number,
  networkEgressGb: number,
) {
  const cpuCost = round(
    cpuVcpuMinutes *
      (RAILWAY_PRICING.cpuPerVcpuMonthUsd / RAILWAY_PRICING.minutesPerMonth),
  );
  const memoryCost = round(
    memoryGbMinutes *
      (RAILWAY_PRICING.memoryPerGbMonthUsd / RAILWAY_PRICING.minutesPerMonth),
  );
  const networkEgressCost = round(
    networkEgressGb * RAILWAY_PRICING.networkEgressPerGbUsd,
  );
  return {
    cpuCost,
    memoryCost,
    networkEgressCost,
    totalCost: round(cpuCost + memoryCost + networkEgressCost),
  };
}

/** Integrate five-minute averaged observability samples for validation. */
export function integrateFiveMinuteAverageSamples(
  samples: AveragedMetricSample[],
  windowStart: string | Date,
  windowEnd: string | Date,
) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      quantityMinutes: 0,
      observedMinutes: 0,
      expectedMinutes: 0,
      completeness: "unavailable" as EstimateCompleteness,
      missingIntervals: 0,
    };
  }

  const validSamples = samples
    .map((sample) => ({
      timestampMs: new Date(sample.timestamp).getTime(),
      value: Number(sample.value),
    }))
    .filter(
      (sample) =>
        Number.isFinite(sample.timestampMs) &&
        Number.isFinite(sample.value) &&
        sample.timestampMs < endMs &&
        sample.timestampMs + FIVE_MINUTES_MS > startMs,
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  let quantityMinutes = 0;
  let observedMinutes = 0;
  for (const sample of validSamples) {
    const intervalStart = Math.max(sample.timestampMs, startMs);
    const intervalEnd = Math.min(sample.timestampMs + FIVE_MINUTES_MS, endMs);
    const minutes = Math.max(0, (intervalEnd - intervalStart) / 60_000);
    quantityMinutes += sample.value * minutes;
    observedMinutes += minutes;
  }

  const expectedMinutes = (endMs - startMs) / 60_000;
  const expectedIntervals = Math.ceil(expectedMinutes / 5);
  const missingIntervals = Math.max(0, expectedIntervals - validSamples.length);
  const ratio = expectedMinutes > 0 ? observedMinutes / expectedMinutes : 0;
  return {
    quantityMinutes: round(quantityMinutes, 6),
    observedMinutes: round(observedMinutes, 6),
    expectedMinutes: round(expectedMinutes, 6),
    completeness:
      validSamples.length === 0
        ? ("unavailable" as const)
        : ratio >= 0.99
          ? ("complete" as const)
          : ("partial" as const),
    missingIntervals,
  };
}

export function normalizeRailwayPlan(
  value: string | undefined,
  start: Date,
  end: Date,
): RailwayPlanType {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "trial" ||
    normalized === "free" ||
    normalized === "hobby" ||
    normalized === "pro"
  ) {
    return normalized;
  }
  const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
  return durationDays > 0 && durationDays <= 15 ? "trial" : "unknown";
}

export function buildReportingPeriod(
  startValue: string | Date,
  endValue: string | Date,
  nowValue: string | Date,
  plan?: string,
): RailwayReportingPeriod {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const now = new Date(nowValue);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    end <= start
  ) {
    return emptyPeriod();
  }
  const elapsedMs = Math.max(
    0,
    Math.min(now.getTime(), end.getTime()) - start.getTime(),
  );
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    source: "railway.workspace.customer.billingPeriod",
    elapsedSeconds: Math.round(elapsedMs / 1000),
    totalSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
    type: normalizeRailwayPlan(plan, start, end),
  };
}

export function reconcileRailwayUsage(
  estimate: number | null,
  railwayProjectUsage: number | null,
  singleProjectWorkspace: boolean,
): RailwayReconciliation {
  if (
    estimate === null ||
    railwayProjectUsage === null ||
    !singleProjectWorkspace
  ) {
    return {
      status: "unavailable",
      railwayProjectUsage: singleProjectWorkspace ? railwayProjectUsage : null,
      absoluteDifference: null,
      percentageDifference: null,
      tolerance: null,
      scope: "unavailable",
      reason: singleProjectWorkspace
        ? "Railway usage comparison is unavailable for this snapshot."
        : "Workspace usage cannot be attributed to one project because multiple active projects exist.",
    };
  }
  const absoluteDifference = Math.abs(estimate - railwayProjectUsage);
  const tolerance = Math.max(0.1, Math.abs(railwayProjectUsage) * 0.03);
  const percentageDifference =
    railwayProjectUsage === 0
      ? estimate === 0
        ? 0
        : null
      : (absoluteDifference / Math.abs(railwayProjectUsage)) * 100;
  return {
    status: absoluteDifference <= tolerance ? "matches" : "differs",
    railwayProjectUsage: round(railwayProjectUsage),
    absoluteDifference: round(absoluteDifference),
    percentageDifference:
      percentageDifference === null ? null : round(percentageDifference, 2),
    tolerance: round(tolerance),
    scope: "workspace-single-project",
    reason: null,
  };
}

export function calculateProjectedPeriodCost(
  currentCost: number | null,
  recentCost: number | null,
  recentWindowSeconds: number,
  remainingPeriodSeconds: number,
) {
  if (
    currentCost === null ||
    recentCost === null ||
    recentWindowSeconds <= 0
  ) {
    return { projectedCost: null, burnPerDay: null };
  }
  const burnPerDay = recentCost / (recentWindowSeconds / 86_400);
  return {
    burnPerDay: round(burnPerDay),
    projectedCost: round(
      currentCost + burnPerDay * (Math.max(remainingPeriodSeconds, 0) / 86_400),
    ),
  };
}

export function summarizeWorkerHealth(
  services: Array<
    Pick<RailwayServiceUsage, "infrastructureState" | "heartbeatState">
  >,
) {
  return {
    online: services.filter(
      (service) => service.infrastructureState === "online",
    ).length,
    infrastructureKnown: services.filter(
      (service) => service.infrastructureState !== "unknown",
    ).length,
    heartbeatHealthy: services.filter(
      (service) => service.heartbeatState === "healthy",
    ).length,
  };
}

function emptyPeriod(): RailwayReportingPeriod {
  return {
    start: null,
    end: null,
    source: "unavailable",
    elapsedSeconds: 0,
    totalSeconds: 0,
    type: "unknown",
  };
}

function unavailableEstimate() {
  return {
    currentGrossCost: null,
    projectedGrossCost: null,
    recentBurnPerDay: null,
    cpuCost: null,
    memoryCost: null,
    networkEgressCost: null,
    completeness: "unavailable" as const,
    missingMeasurements: [...REQUIRED_MEASUREMENTS],
    methodologyVersion: RAILWAY_PRICING.methodologyVersion,
  };
}

export function createUnavailableRailwayCredit(
  workspaceId: string | null,
  plan: RailwayPlanType,
  fetchedAt: string,
) {
  return {
    source: "unavailable" as const,
    availableUsd: null,
    expiresAt: null,
    plan,
    fetchedAt,
    dashboardUrl: workspaceId
      ? `https://railway.com/workspace/usage?workspaceId=${encodeURIComponent(workspaceId)}`
      : null,
  };
}

function unavailableReconciliation(reason: string): RailwayReconciliation {
  return {
    status: "unavailable",
    railwayProjectUsage: null,
    absoluteDifference: null,
    percentageDifference: null,
    tolerance: null,
    scope: "unavailable",
    reason,
  };
}

function emptyReport(input: {
  configured: boolean;
  projectId: string | null;
  workspaceId: string | null;
  now: Date;
  telemetry: WorkerTelemetrySnapshot[];
  error: string;
}): RailwayUsageReport {
  const fetchedAt = input.now.toISOString();
  return {
    configured: input.configured,
    projectName: null,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    period: emptyPeriod(),
    estimate: unavailableEstimate(),
    credit: createUnavailableRailwayCredit(input.workspaceId, "unknown", fetchedAt),
    reconciliation: unavailableReconciliation(
      "Railway usage comparison is unavailable for this snapshot.",
    ),
    services: [],
    infrastructureOnlineCount: 0,
    infrastructureKnownCount: 0,
    heartbeatHealthyCount: 0,
    parkedServicesCount: 0,
    workerTelemetry: input.telemetry,
    lastUpdated: fetchedAt,
    warnings: [],
    error: input.error,
  };
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function railwayGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Railway API returned HTTP ${response.status}.`);
  }
  const envelope = (await response.json()) as GraphqlEnvelope<T>;
  if (envelope.errors?.length) {
    throw new Error(envelope.errors.map((error) => error.message).join("; "));
  }
  if (!envelope.data) throw new Error("Railway API returned no data.");
  return envelope.data;
}

async function fetchWorkerTelemetry(): Promise<WorkerTelemetrySnapshot[]> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const telemetryLogs = await prisma.appLog.findMany({
      where: { context: "worker/metrics" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        workerId: true,
        workerName: true,
        createdAt: true,
        metadata: true,
      },
    });
    return telemetryLogs
      .map((log) => {
        const rawMeta = log.metadata as Record<string, unknown> | null;
        const data = (rawMeta?.data ?? rawMeta ?? {}) as Record<string, unknown>;
        return {
          id: log.id,
          workerId: log.workerId ?? "unknown",
          workerName: log.workerName ?? "ListFlow Worker",
          timestamp: log.createdAt.toISOString(),
          rssMB: Number(data.rssMB ?? 0),
          heapUsedMB: Number(data.heapUsedMB ?? 0),
          heapTotalMB: Number(data.heapTotalMB ?? 0),
          externalMB: Number(data.externalMB ?? 0),
          cpuUserMs: Number(data.cpuUserMs ?? 0),
          cpuSystemMs: Number(data.cpuSystemMs ?? 0),
          cpuPercent: Number(data.cpuPercent ?? 0),
          uptimeSeconds: Number(data.uptimeSeconds ?? 0),
          jobsProcessed: Number(data.jobsProcessed ?? 0),
        };
      })
      .filter((snapshot) => snapshot.rssMB > 0 || snapshot.heapUsedMB > 0);
  } catch {
    return [];
  }
}

type UsageEntry = {
  measurement: string;
  value: number;
  tags: { projectId?: string; serviceId?: string };
};

function groupUsageByService(entries: UsageEntry[], projectId: string) {
  const map = new Map<string, RailwayMetricTotals>();
  const presentMeasurements = new Set<string>();
  for (const entry of entries) {
    if (entry.tags.projectId !== projectId || !entry.tags.serviceId) continue;
    presentMeasurements.add(entry.measurement);
    const current = map.get(entry.tags.serviceId) ?? {
      cpuVcpuMinutes: 0,
      memoryGbMinutes: 0,
      networkEgressGb: 0,
    };
    if (entry.measurement === "CPU_USAGE") current.cpuVcpuMinutes += entry.value;
    if (entry.measurement === "MEMORY_USAGE_GB") current.memoryGbMinutes += entry.value;
    if (entry.measurement === "NETWORK_TX_GB") current.networkEgressGb += entry.value;
    map.set(entry.tags.serviceId, current);
  }
  return { map, presentMeasurements };
}

function totalsFromEntries(entries: UsageEntry[], projectId: string) {
  const { map, presentMeasurements } = groupUsageByService(entries, projectId);
  const totals = Array.from(map.values()).reduce<RailwayMetricTotals>(
    (sum, usage) => ({
      cpuVcpuMinutes: sum.cpuVcpuMinutes + usage.cpuVcpuMinutes,
      memoryGbMinutes: sum.memoryGbMinutes + usage.memoryGbMinutes,
      networkEgressGb: sum.networkEgressGb + usage.networkEgressGb,
    }),
    { cpuVcpuMinutes: 0, memoryGbMinutes: 0, networkEgressGb: 0 },
  );
  return { totals, presentMeasurements };
}

function deploymentState(status: string | null): InfrastructureState {
  if (status === "SUCCESS") return "online";
  if (["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"].includes(status ?? "")) {
    return "starting";
  }
  if (["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(status ?? "")) {
    return "offline";
  }
  return "unknown";
}

function serviceKeyCandidates(name: string) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return [name.toLowerCase(), sanitized, `worker-${sanitized}`];
}

export async function fetchRailwayUsageReport(): Promise<RailwayUsageReport> {
  const now = new Date();
  const fetchedAt = now.toISOString();
  const token = process.env.RAILWAY_API_TOKEN?.trim() ?? "";
  const projectId = process.env.RAILWAY_PROJECT_ID?.trim() ?? "";
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID?.trim() ?? "";
  const workerTelemetry = await fetchWorkerTelemetry();
  const missingConfiguration = [
    !token && "RAILWAY_API_TOKEN",
    !projectId && "RAILWAY_PROJECT_ID",
    !workspaceId && "RAILWAY_WORKSPACE_ID",
  ].filter(Boolean) as string[];
  if (missingConfiguration.length) {
    return emptyReport({
      configured: false,
      projectId: projectId || null,
      workspaceId: workspaceId || null,
      now,
      telemetry: workerTelemetry,
      error: `Missing Railway environment configuration: ${missingConfiguration.join(", ")}.`,
    });
  }

  try {
    const context = await railwayGraphql<{
      workspace: {
        id: string;
        customer: {
          currentUsage: number | null;
          billingPeriod: { start: string; end: string } | null;
        } | null;
      } | null;
      project: {
        id: string;
        name: string;
        services: { edges: Array<{ node: { id: string; name: string } }> };
        environments: { edges: Array<{ node: { id: string; name: string } }> };
      } | null;
      projects: {
        edges: Array<{ node: { id: string; name: string; deletedAt: string | null } }>;
      };
    }>(token, `
      query RailwayUsageContext($workspaceId: String!, $projectId: String!) {
        workspace(workspaceId: $workspaceId) {
          id
          customer { currentUsage billingPeriod { start end } }
        }
        project(id: $projectId) {
          id
          name
          services { edges { node { id name } } }
          environments { edges { node { id name } } }
        }
        projects(first: 5000, includeDeleted: true, workspaceId: $workspaceId) {
          edges { node { id name deletedAt } }
        }
      }
    `, { workspaceId, projectId });

    if (!context.workspace?.customer?.billingPeriod) {
      throw new Error("Railway did not return an active billing period.");
    }
    if (!context.project) {
      throw new Error("Railway project was not found in the configured workspace.");
    }
    const period = buildReportingPeriod(
      context.workspace.customer.billingPeriod.start,
      context.workspace.customer.billingPeriod.end,
      now,
      process.env.RAILWAY_PLAN,
    );
    if (!period.start || !period.end) {
      throw new Error("Railway returned an invalid billing period.");
    }

    const periodEnd = new Date(period.end);
    const usageEnd = new Date(Math.min(now.getTime(), periodEnd.getTime()));
    const recentStart = new Date(
      Math.max(new Date(period.start).getTime(), usageEnd.getTime() - 86_400_000),
    );
    const usageData = await railwayGraphql<{
      currentUsage: UsageEntry[];
      recentUsage: UsageEntry[];
    }>(token, `
      query RailwayProjectUsage(
        $workspaceId: String!
        $measurements: [MetricMeasurement!]!
        $startDate: DateTime!
        $recentStartDate: DateTime!
        $endDate: DateTime!
      ) {
        currentUsage: usage(
          workspaceId: $workspaceId
          measurements: $measurements
          groupBy: [PROJECT_ID, SERVICE_ID]
          startDate: $startDate
          endDate: $endDate
          includeDeleted: true
        ) { measurement value tags { projectId serviceId } }
        recentUsage: usage(
          workspaceId: $workspaceId
          measurements: $measurements
          groupBy: [PROJECT_ID, SERVICE_ID]
          startDate: $recentStartDate
          endDate: $endDate
          includeDeleted: true
        ) { measurement value tags { projectId serviceId } }
      }
    `, {
      workspaceId,
      measurements: REQUIRED_MEASUREMENTS,
      startDate: period.start,
      recentStartDate: recentStart.toISOString(),
      endDate: usageEnd.toISOString(),
    });

    const currentGrouped = groupUsageByService(usageData.currentUsage ?? [], projectId);
    const currentTotals = totalsFromEntries(usageData.currentUsage ?? [], projectId);
    const missingMeasurements = REQUIRED_MEASUREMENTS.filter(
      (measurement) => !currentTotals.presentMeasurements.has(measurement),
    );
    const completeness: EstimateCompleteness =
      currentTotals.presentMeasurements.size === 0
        ? "unavailable"
        : missingMeasurements.length
          ? "partial"
          : "complete";
    const totalCosts = completeness === "complete"
      ? calculateServiceCost(
          currentTotals.totals.cpuVcpuMinutes,
          currentTotals.totals.memoryGbMinutes,
          currentTotals.totals.networkEgressGb,
        )
      : null;

    const recentTotals = totalsFromEntries(usageData.recentUsage ?? [], projectId);
    const recentComplete = REQUIRED_MEASUREMENTS.every((measurement) =>
      recentTotals.presentMeasurements.has(measurement),
    );
    const recentCosts = recentComplete
      ? calculateServiceCost(
          recentTotals.totals.cpuVcpuMinutes,
          recentTotals.totals.memoryGbMinutes,
          recentTotals.totals.networkEgressGb,
        )
      : null;
    const recentWindowSeconds = Math.max(
      0,
      (usageEnd.getTime() - recentStart.getTime()) / 1000,
    );
    const remainingPeriodSeconds = Math.max(
      0,
      (periodEnd.getTime() - usageEnd.getTime()) / 1000,
    );
    const projection = calculateProjectedPeriodCost(
      totalCosts?.totalCost ?? null,
      recentCosts?.totalCost ?? null,
      recentWindowSeconds,
      remainingPeriodSeconds,
    );

    const knownServices = context.project.services.edges.map((edge) => edge.node);
    const environment = context.project.environments.edges.find(
      (edge) => edge.node.name.toLowerCase() === "production",
    )?.node ?? context.project.environments.edges[0]?.node ?? null;
    const deploymentStatuses = new Map<string, string | null>();
    const warnings: string[] = [];
    if (environment && knownServices.length) {
      try {
        const aliases = knownServices.map(
          (service, index) =>
            `s${index}: serviceInstance(environmentId: $environmentId, serviceId: ${JSON.stringify(service.id)}) { latestDeployment { status } }`,
        ).join("\n");
        const statusData = await railwayGraphql<
          Record<string, { latestDeployment: { status: string } | null } | null>
        >(token, `query RailwayServiceStatuses($environmentId: String!) { ${aliases} }`, {
          environmentId: environment.id,
        });
        knownServices.forEach((service, index) => {
          deploymentStatuses.set(
            service.id,
            statusData[`s${index}`]?.latestDeployment?.status ?? null,
          );
        });
      } catch {
        warnings.push("Railway deployment status is temporarily unavailable.");
      }
    } else {
      warnings.push("Railway production environment status is unavailable.");
    }

    const heartbeatByWorkerId = new Map<string, {
      workerRole: "unified" | "store-specific" | "legacy";
      lastSeenAt: Date;
    }>();
    const coverageByWorkerId = new Map<string, Set<string>>();
    const activeLeaseCountByWorkerId = new Map<string, number>();
    try {
      const { prisma } = await import("@/lib/prisma");
      const [heartbeats, leases] = await Promise.all([
        prisma.workerHeartbeat.findMany({
          orderBy: { lastSeenAt: "desc" },
          select: {
            workerId: true,
            workerRole: true,
            lastSeenAt: true,
            store: { select: { loginId: true, name: true } },
          },
        }),
        prisma.jobLease.findMany({
          where: { expiresAt: { gt: now }, NOT: { jobType: "GATE" } },
          select: { workerId: true },
        }),
      ]);
      for (const heartbeat of heartbeats) {
        const key = heartbeat.workerId.toLowerCase();
        const coverage = coverageByWorkerId.get(key) ?? new Set<string>();
        coverage.add(heartbeat.store.loginId ?? heartbeat.store.name);
        coverageByWorkerId.set(key, coverage);
        if (!heartbeatByWorkerId.has(key)) {
          heartbeatByWorkerId.set(key, {
            workerRole:
              heartbeat.workerRole === "unified" || heartbeat.workerRole === "store-specific"
                ? heartbeat.workerRole
                : "legacy",
            lastSeenAt: heartbeat.lastSeenAt,
          });
        }
      }
      for (const lease of leases) {
        const key = lease.workerId.toLowerCase();
        activeLeaseCountByWorkerId.set(
          key,
          (activeLeaseCountByWorkerId.get(key) ?? 0) + 1,
        );
      }
    } catch {
      warnings.push("ListFlow heartbeat and lease telemetry is temporarily unavailable.");
    }

    const explicitParkedNames = new Set(
      (process.env.LISTFLOW_PARKED_SERVICES ?? "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    );
    const services: RailwayServiceUsage[] = knownServices.map((service) => {
      const usage = currentGrouped.map.get(service.id) ?? {
        cpuVcpuMinutes: 0,
        memoryGbMinutes: 0,
        networkEgressGb: 0,
      };
      const costs = calculateServiceCost(
        usage.cpuVcpuMinutes,
        usage.memoryGbMinutes,
        usage.networkEgressGb,
      );
      const candidates = serviceKeyCandidates(service.name);
      const heartbeat = candidates
        .map((candidate) => heartbeatByWorkerId.get(candidate))
        .find((value) => value !== undefined) ?? null;
      const coverageSet = candidates
        .map((candidate) => coverageByWorkerId.get(candidate))
        .find((value) => value !== undefined) ?? null;
      const workerRole = heartbeat?.workerRole ??
        (service.name === "worker-all-stores"
          ? "unified"
          : service.name.startsWith("worker-")
            ? "store-specific"
            : null);
      const heartbeatState: HeartbeatState = !heartbeat
        ? "missing"
        : now.getTime() - heartbeat.lastSeenAt.getTime() <= HEARTBEAT_HEALTHY_MS
          ? "healthy"
          : "stale";
      const coverage = coverageSet?.size
        ? Array.from(coverageSet).sort().join(", ")
        : workerRole === "unified"
          ? "All active stores"
          : workerRole === "store-specific"
            ? "One configured store"
            : "Unknown / legacy";
      const deploymentStatus = deploymentStatuses.get(service.id) ?? null;
      return {
        id: service.id,
        name: service.name,
        cpuVcpuMinutes: round(usage.cpuVcpuMinutes, 2),
        memoryGbMinutes: round(usage.memoryGbMinutes, 2),
        networkEgressGb: round(usage.networkEgressGb, 4),
        ...costs,
        infrastructureState: deploymentState(deploymentStatus),
        deploymentStatus,
        heartbeatState,
        lastHeartbeatAt: heartbeat?.lastSeenAt.toISOString() ?? null,
        isParked: candidates.some((candidate) => explicitParkedNames.has(candidate)),
        workerRole,
        coverage,
        activeLeaseCount: candidates
          .map((candidate) => activeLeaseCountByWorkerId.get(candidate))
          .find((count) => count !== undefined) ?? 0,
      };
    });
    services.sort((a, b) => b.totalCost - a.totalCost);

    if (completeness !== "complete") {
      warnings.push(
        `Railway metric snapshot is ${completeness}; missing ${missingMeasurements.join(", ") || "billable usage"}. Cost is not estimated from incomplete data.`,
      );
    }
    if (!recentComplete) {
      warnings.push("The recent burn-rate window is incomplete, so period projection is unavailable.");
    }

    const activeProjects = context.projects.edges.filter(
      (edge) => edge.node.deletedAt === null,
    );
    const singleProjectWorkspace =
      activeProjects.length === 1 && activeProjects[0]?.node.id === projectId;
    const reconciliation = reconcileRailwayUsage(
      totalCosts?.totalCost ?? null,
      context.workspace.customer.currentUsage,
      singleProjectWorkspace,
    );
    const health = summarizeWorkerHealth(services);
    return {
      configured: true,
      projectName: context.project.name,
      projectId,
      workspaceId,
      period,
      estimate: {
        currentGrossCost: totalCosts?.totalCost ?? null,
        projectedGrossCost: projection.projectedCost,
        recentBurnPerDay: projection.burnPerDay,
        cpuCost: totalCosts?.cpuCost ?? null,
        memoryCost: totalCosts?.memoryCost ?? null,
        networkEgressCost: totalCosts?.networkEgressCost ?? null,
        completeness,
        missingMeasurements,
        methodologyVersion: RAILWAY_PRICING.methodologyVersion,
      },
      credit: createUnavailableRailwayCredit(workspaceId, period.type, fetchedAt),
      reconciliation,
      services,
      infrastructureOnlineCount: health.online,
      infrastructureKnownCount: health.infrastructureKnown,
      heartbeatHealthyCount: health.heartbeatHealthy,
      parkedServicesCount: services.filter((service) => service.isParked).length,
      workerTelemetry,
      lastUpdated: fetchedAt,
      warnings,
      error: null,
    };
  } catch (error) {
    return emptyReport({
      configured: true,
      projectId,
      workspaceId,
      now,
      telemetry: workerTelemetry,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
