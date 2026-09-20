export const PRICE_CHECK_OPTIMIZATION_NAMES = [
  "progress-write",
  "shared-snapshot",
  "delivery-state",
] as const;

export type PriceCheckOptimizationName =
  (typeof PRICE_CHECK_OPTIMIZATION_NAMES)[number];

export type PriceCheckOptimizationEnvironment = Record<
  string,
  string | undefined
>;

export type PriceCheckOptimizationConfig = {
  timingEnabled: boolean;
  requested: PriceCheckOptimizationName[];
  enabled: PriceCheckOptimizationName[];
  allowedStoreIds: string[];
  storeAllowed: boolean;
  unknown: string[];
};

function isEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function parseList(value: string | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function resolvePriceCheckOptimizationConfig(
  storeId: string | undefined,
  environment: PriceCheckOptimizationEnvironment = process.env,
): PriceCheckOptimizationConfig {
  const rawRequested = parseList(
    environment.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS,
  );
  const known = new Set<string>(PRICE_CHECK_OPTIMIZATION_NAMES);
  const unknown = rawRequested.filter((name) => !known.has(name));
  const requested = rawRequested.filter(
    (name): name is PriceCheckOptimizationName => known.has(name),
  );
  const allowedStoreIds = parseList(
    environment.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS,
  );
  const storeAllowed = Boolean(
    storeId && allowedStoreIds.includes(storeId),
  );

  return {
    timingEnabled: isEnabled(
      environment.LISTFLOW_PRICE_CHECK_TIMING_ENABLED,
    ),
    requested,
    enabled: unknown.length === 0 && storeAllowed ? requested : [],
    allowedStoreIds,
    storeAllowed,
    unknown,
  };
}

export function getPriceCheckOptimizationEnvironmentSummary(
  environment: PriceCheckOptimizationEnvironment = process.env,
) {
  const config = resolvePriceCheckOptimizationConfig(undefined, environment);
  return {
    timingEnabled: config.timingEnabled,
    requested: config.requested,
    allowedStoreIds: config.allowedStoreIds,
    unknown: config.unknown,
  };
}

type TimingBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export class PriceCheckTimingRecorder {
  private readonly startedAt = Date.now();
  private readonly stages = new Map<string, TimingBucket>();
  private readonly counters = new Map<string, number>();

  constructor(readonly enabled: boolean) {}

  record(stage: string, durationMs: number) {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;

    const current = this.stages.get(stage) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.stages.set(stage, current);
  }

  increment(counter: string, amount = 1) {
    if (!this.enabled || !Number.isFinite(amount)) return;
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + amount);
  }

  snapshot() {
    return {
      elapsedMs: Date.now() - this.startedAt,
      stages: Object.fromEntries(
        Array.from(this.stages.entries()).map(([name, value]) => [
          name,
          {
            count: value.count,
            totalMs: Math.round(value.totalMs),
            maxMs: Math.round(value.maxMs),
          },
        ]),
      ),
      counters: Object.fromEntries(this.counters),
    };
  }
}
