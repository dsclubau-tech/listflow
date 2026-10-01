export const PRICE_CHECK_OPTIMIZATION_NAMES = [
  "progress-write",
  "shared-snapshot",
  "delivery-state",
] as const;

export const DELIVERY_STATE_MODES = ["allowlist", "all", "off"] as const;
export type DeliveryStateMode = (typeof DELIVERY_STATE_MODES)[number];
export type PriceCheckOptimizationName = (typeof PRICE_CHECK_OPTIMIZATION_NAMES)[number];
export type PriceCheckOptimizationEnvironment = Record<string, string | undefined>;

export type PriceCheckOptimizationConfig = {
  timingEnabled: boolean;
  requested: PriceCheckOptimizationName[];
  enabled: PriceCheckOptimizationName[];
  allowedStoreIds: string[];
  deliveryStateAllowedStoreIds: string[] | null;
  deliveryStateMode: DeliveryStateMode | null;
  deliveryStateDisabledStoreIds: string[];
  deliveryStateEnabled: boolean;
  deliveryStateDisabledReason: string | null;
  deliveryStateConfigurationIssue: string | null;
  storeAllowed: boolean;
  unknown: string[];
};

function isEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function parseList(value: string | undefined) {
  return Array.from(new Set((value ?? "").split(",").map(item => item.trim()).filter(Boolean)));
}

export function resolvePriceCheckOptimizationConfig(
  storeId: string | undefined,
  environment: PriceCheckOptimizationEnvironment = process.env,
): PriceCheckOptimizationConfig {
  const rawRequested = parseList(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS);
  const known = new Set<string>(PRICE_CHECK_OPTIMIZATION_NAMES);
  const unknown = rawRequested.filter(name => !known.has(name));
  const requested = rawRequested.filter(
    (name): name is PriceCheckOptimizationName => known.has(name),
  );
  const allowedStoreIds = parseList(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS);
  const identified = Boolean(storeId?.trim());
  const storeAllowed = Boolean(identified && allowedStoreIds.includes(storeId!));
  // Absence retains legacy scope. An explicit empty allowlist enables no stores in allowlist mode.
  const deliveryStateAllowedStoreIds = environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS === undefined
    ? null
    : parseList(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS);
  const rawMode = environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE?.trim().toLowerCase();
  const deliveryStateMode = rawMode === undefined ? "allowlist"
    : (DELIVERY_STATE_MODES as readonly string[]).includes(rawMode) ? rawMode as DeliveryStateMode : null;
  const deliveryStateDisabledStoreIds = parseList(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS);
  const reuseRequested = requested.includes("delivery-state");
  const deliveryStateConfigurationIssue = deliveryStateMode === null
    ? "Invalid postcode reuse mode; expected allowlist, all, or off."
    : reuseRequested && deliveryStateMode !== "off" && !identified
      ? "Postcode reuse requires a database store identity."
      : null;
  let deliveryStateDisabledReason: string | null = null;
  if (deliveryStateConfigurationIssue) deliveryStateDisabledReason = deliveryStateConfigurationIssue;
  else if (unknown.length > 0) deliveryStateDisabledReason = "Unknown optimization disables requested optimizations.";
  else if (!reuseRequested) deliveryStateDisabledReason = "The delivery-state feature is not configured.";
  else if (deliveryStateMode === "off") deliveryStateDisabledReason = "Postcode reuse is disabled globally.";
  else if (deliveryStateDisabledStoreIds.includes(storeId!)) deliveryStateDisabledReason = "This store is excluded from postcode reuse.";
  else if (deliveryStateMode === "allowlist" && (!storeAllowed ||
    (deliveryStateAllowedStoreIds !== null && !deliveryStateAllowedStoreIds.includes(storeId!)))) {
    deliveryStateDisabledReason = "This store is outside the postcode reuse allowlists.";
  }
  const deliveryStateEnabled = deliveryStateDisabledReason === null;

  return {
    timingEnabled: isEnabled(environment.LISTFLOW_PRICE_CHECK_TIMING_ENABLED),
    requested,
    enabled: unknown.length === 0 ? requested.filter(name => name === "delivery-state"
      ? deliveryStateEnabled : storeAllowed) : [],
    allowedStoreIds,
    deliveryStateAllowedStoreIds,
    deliveryStateMode,
    deliveryStateDisabledStoreIds,
    deliveryStateEnabled,
    deliveryStateDisabledReason,
    deliveryStateConfigurationIssue,
    storeAllowed,
    unknown,
  };
}

export function getPriceCheckOptimizationEnvironmentSummary(
  environment: PriceCheckOptimizationEnvironment = process.env,
  storeIds: string[] = [],
) {
  const config = resolvePriceCheckOptimizationConfig(undefined, environment);
  return {
    timingEnabled: config.timingEnabled,
    requested: config.requested,
    allowedStoreIds: config.allowedStoreIds,
    deliveryStateAllowedStoreIds: config.deliveryStateAllowedStoreIds,
    deliveryStateMode: config.deliveryStateMode,
    deliveryStateDisabledStoreIds: config.deliveryStateDisabledStoreIds,
    unknown: config.unknown,
    stores: Array.from(new Set(storeIds)).map(storeId => {
      const effective = resolvePriceCheckOptimizationConfig(storeId, environment);
      return {
        storeId,
        enabled: effective.enabled,
        deliveryStateEnabled: effective.deliveryStateEnabled,
        deliveryStateDisabledReason: effective.deliveryStateDisabledReason,
        deliveryStateConfigurationIssue: effective.deliveryStateConfigurationIssue,
      };
    }),
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
