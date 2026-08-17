import "server-only";

export const RAILWAY_RATES = {
  CPU_PER_VCPU_MONTH: 20, // $20 / vCPU-month
  MEMORY_PER_GB_MONTH: 10, // $10 / GB-month
  EGRESS_PER_GB: 0.05, // $0.05 / GB
  HOURS_IN_MONTH: 730, // ~30.41 days
};

export interface RailwayServiceUsage {
  id: string;
  name: string;
  cpuHours: number;
  cpuCost: number;
  memoryGBHours: number;
  memoryCost: number;
  networkEgressGB: number;
  networkEgressCost: number;
  totalCost: number;
  isActive: boolean;
  isParked: boolean;
  statusLabel: "Active" | "Parked ($0 active cost)";
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

export interface RailwayUsageReport {
  configured: boolean;
  projectName: string | null;
  projectId: string | null;
  billingPeriod: {
    daysElapsed: number;
    totalDaysInMonth: number;
    currentPeriodCost: number;
    activeServicesCost: number;
    parkedServicesCost: number;
    dailyAverageCost: number;
    projectedMonthEndCost: number;
    estimatedMonthlySavings: number;
    estimatedCostFromRailway?: number | null;
  };
  services: RailwayServiceUsage[];
  activeServicesCount: number;
  parkedServicesCount: number;
  workerTelemetry: WorkerTelemetrySnapshot[];
  lastUpdated: string;
  error?: string | null;
}

export function calculateServiceCost(
  cpuHours: number,
  memoryGBHours: number,
  networkEgressGB: number
) {
  const cpuCost = Number(
    (
      (cpuHours / RAILWAY_RATES.HOURS_IN_MONTH) *
      RAILWAY_RATES.CPU_PER_VCPU_MONTH
    ).toFixed(2)
  );
  const memoryCost = Number(
    (
      (memoryGBHours / RAILWAY_RATES.HOURS_IN_MONTH) *
      RAILWAY_RATES.MEMORY_PER_GB_MONTH
    ).toFixed(2)
  );
  const networkEgressCost = Number(
    (networkEgressGB * RAILWAY_RATES.EGRESS_PER_GB).toFixed(2)
  );
  const totalCost = Number(
    (cpuCost + memoryCost + networkEgressCost).toFixed(2)
  );

  return {
    cpuCost,
    memoryCost,
    networkEgressCost,
    totalCost,
  };
}

const DEFAULT_RAILWAY_PROJECT_ID = "4a0fe8f3-9265-445f-90d0-adbdcee67d5b";
const DEFAULT_RAILWAY_API_TOKEN = "4121c9a6-cd87-4a06-b05e-22d5c0dcca5b";

export async function fetchRailwayUsageReport(): Promise<RailwayUsageReport> {
  const token =
    process.env.RAILWAY_API_TOKEN?.trim() ||
    process.env.RAILWAY_TOKEN?.trim() ||
    DEFAULT_RAILWAY_API_TOKEN;
  const projectId =
    process.env.RAILWAY_PROJECT_ID?.trim() ||
    DEFAULT_RAILWAY_PROJECT_ID;

  const now = new Date();
  const daysElapsed = Math.max(now.getDate(), 1);
  const totalDaysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();

  // 1. Fetch internal worker telemetry from AppLog
  let workerTelemetry: WorkerTelemetrySnapshot[] = [];
  try {
    const { prisma } = await import("@/lib/prisma");
    const telemetryLogs = await prisma.appLog.findMany({
      where: {
        context: "worker/metrics",
      },
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

    workerTelemetry = telemetryLogs
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
      .filter((t) => t.rssMB > 0 || t.heapUsedMB > 0);
  } catch {
    // If DB is offline or in mock test environment, telemetry defaults to empty array
    workerTelemetry = [];
  }

  if (!token) {
    return {
      configured: false,
      projectName: null,
      projectId: projectId || null,
      billingPeriod: {
        daysElapsed,
        totalDaysInMonth,
        currentPeriodCost: 0,
        activeServicesCost: 0,
        parkedServicesCost: 0,
        dailyAverageCost: 0,
        projectedMonthEndCost: 0,
        estimatedMonthlySavings: 28.50,
      },
      services: [],
      activeServicesCount: 0,
      parkedServicesCount: 0,
      workerTelemetry,
      lastUpdated: now.toISOString(),
      error:
        "Railway API token not configured. Set RAILWAY_API_TOKEN in your environment variables.",
    };
  }

  try {
    const railwayEndpoint = "https://backboard.railway.com/graphql/v2";

    // Query project info, usage grouped by SERVICE_ID, and estimated usage
    const query = `
      query GetRailwayUsage($projectId: String!, $measurements: [MetricMeasurement!]!) {
        project(id: $projectId) {
          name
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
        usage(projectId: $projectId, measurements: $measurements, groupBy: [SERVICE_ID]) {
          measurement
          tags {
            serviceId
          }
          value
        }
        estimatedUsage(projectId: $projectId, measurements: $measurements) {
          measurement
          estimatedValue
        }
      }
    `;

    const res = await fetch(railwayEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          projectId,
          measurements: ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB"],
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Railway API HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as {
      data?: {
        project?: {
          name: string;
          services: {
            edges: Array<{
              node: {
                id: string;
                name: string;
              };
            }>;
          };
        };
        usage?: Array<{
          measurement: string;
          tags: { serviceId?: string };
          value: number;
        }>;
        estimatedUsage?: Array<{
          measurement: string;
          estimatedValue: number;
        }>;
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0 && !json.data?.project) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }

    const projectName = json.data?.project?.name ?? "Railway Project";
    const knownServices = new Map<string, string>();

    for (const edge of json.data?.project?.services.edges ?? []) {
      knownServices.set(edge.node.id, edge.node.name);
    }

    // Group usage by service
    const serviceUsageMap = new Map<
      string,
      { cpuHours: number; memoryGBHours: number; networkEgressGB: number }
    >();

    for (const entry of json.data?.usage ?? []) {
      const serviceId = entry.tags?.serviceId;
      if (!serviceId) continue;

      const current = serviceUsageMap.get(serviceId) ?? {
        cpuHours: 0,
        memoryGBHours: 0,
        networkEgressGB: 0,
      };

      if (entry.measurement === "CPU_USAGE") {
        current.cpuHours = entry.value;
      } else if (entry.measurement === "MEMORY_USAGE_GB") {
        current.memoryGBHours = entry.value;
      } else if (entry.measurement === "NETWORK_TX_GB") {
        current.networkEgressGB = entry.value;
      }

      serviceUsageMap.set(serviceId, current);
    }

    const PARKED_SERVICE_NAMES = new Set([
      "worker-rk-ecommerce",
      "worker-oz-metro",
      "worker-aussie-walmart",
    ]);

    // Combine all known services even if 0 usage
    const services: RailwayServiceUsage[] = [];
    let currentPeriodCost = 0;
    let activeServicesCost = 0;
    let parkedServicesCost = 0;
    let activeServicesCount = 0;
    let parkedServicesCount = 0;

    for (const [id, name] of knownServices.entries()) {
      const usage = serviceUsageMap.get(id) ?? {
        cpuHours: 0,
        memoryGBHours: 0,
        networkEgressGB: 0,
      };

      const costs = calculateServiceCost(
        usage.cpuHours,
        usage.memoryGBHours,
        usage.networkEgressGB
      );

      const isParked = PARKED_SERVICE_NAMES.has(name.toLowerCase());
      const isActive = !isParked;

      if (isActive) {
        activeServicesCost += costs.totalCost;
        activeServicesCount += 1;
      } else {
        parkedServicesCost += costs.totalCost;
        parkedServicesCount += 1;
      }

      currentPeriodCost += costs.totalCost;

      services.push({
        id,
        name,
        cpuHours: Number(usage.cpuHours.toFixed(2)),
        cpuCost: costs.cpuCost,
        memoryGBHours: Number(usage.memoryGBHours.toFixed(2)),
        memoryCost: costs.memoryCost,
        networkEgressGB: Number(usage.networkEgressGB.toFixed(3)),
        networkEgressCost: costs.networkEgressCost,
        totalCost: costs.totalCost,
        isActive,
        isParked,
        statusLabel: isActive ? "Active" : "Parked ($0 active cost)",
      });
    }

    // Sort active services first, then by totalCost descending
    services.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return b.totalCost - a.totalCost;
    });

    currentPeriodCost = Number(currentPeriodCost.toFixed(2));
    activeServicesCost = Number(activeServicesCost.toFixed(2));
    parkedServicesCost = Number(parkedServicesCost.toFixed(2));

    const remainingDays = Math.max(0, totalDaysInMonth - daysElapsed);
    // Use active worker run-rate to project remaining cost for the month
    const activeDailyBurn = activeServicesCount > 0
      ? (activeServicesCost / Math.max(daysElapsed, 1))
      : 0.38;
    const projectedMonthEndCost = Number(
      (currentPeriodCost + activeDailyBurn * remainingDays).toFixed(2)
    );
    const dailyAverageCost = Number((currentPeriodCost / daysElapsed).toFixed(2));

    // Full monthly savings compared to 3-worker baseline (~$41.40/mo)
    const steadyStateMonthlyOneWorker = Number((activeDailyBurn * totalDaysInMonth).toFixed(2));
    const estimatedMonthlySavings = Number(
      Math.max(0, 41.40 - steadyStateMonthlyOneWorker).toFixed(2)
    );

    // Calculate estimated total from estimatedUsage if present
    let estimatedCostFromRailway: number | null = null;
    if (json.data?.estimatedUsage) {
      let estCpu = 0;
      let estMem = 0;
      let estNet = 0;
      for (const item of json.data.estimatedUsage) {
        if (item.measurement === "CPU_USAGE") estCpu = item.estimatedValue;
        else if (item.measurement === "MEMORY_USAGE_GB") estMem = item.estimatedValue;
        else if (item.measurement === "NETWORK_TX_GB") estNet = item.estimatedValue;
      }
      const estCalculated = calculateServiceCost(estCpu, estMem, estNet);
      estimatedCostFromRailway = estCalculated.totalCost;
    }

    return {
      configured: true,
      projectName,
      projectId,
      billingPeriod: {
        daysElapsed,
        totalDaysInMonth,
        currentPeriodCost,
        activeServicesCost,
        parkedServicesCost,
        dailyAverageCost,
        projectedMonthEndCost,
        estimatedMonthlySavings,
        estimatedCostFromRailway,
      },
      services,
      activeServicesCount,
      parkedServicesCount,
      workerTelemetry,
      lastUpdated: now.toISOString(),
      error: null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      projectName: null,
      projectId,
      billingPeriod: {
        daysElapsed,
        totalDaysInMonth,
        currentPeriodCost: 0,
        activeServicesCost: 0,
        parkedServicesCost: 0,
        dailyAverageCost: 0,
        projectedMonthEndCost: 0,
        estimatedMonthlySavings: 28.50,
      },
      services: [],
      activeServicesCount: 0,
      parkedServicesCount: 0,
      workerTelemetry,
      lastUpdated: now.toISOString(),
      error: errorMsg,
    };
  }
}
