export const WORKER_ROLES = ["unified", "store-specific"] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number] | "legacy";

export const DEFAULT_WORKER_CLAIM_GRACE_MS = 3_000;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function parsePositiveWorkerMs(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWorkerEnabled(input: {
  value: string | undefined;
  isRailway: boolean;
}) {
  const normalized = input.value?.trim().toLowerCase();

  if (!normalized) {
    if (input.isRailway) {
      throw new Error(
        "LISTFLOW_WORKER_ENABLED must be explicitly set to true or false on Railway."
      );
    }

    return true;
  }

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(
    "LISTFLOW_WORKER_ENABLED must be one of true, false, 1, 0, yes, no, on, or off."
  );
}

export function resolveWorkerRole(
  value: string | undefined,
  storeFilters: string[],
  options: { requireExplicit?: boolean } = {},
): WorkerRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized && options.requireExplicit) {
    throw new Error("LISTFLOW_WORKER_ROLE must be explicitly set on Railway.");
  }
  const role: WorkerRole = normalized
    ? normalized === "unified" || normalized === "store-specific"
      ? normalized
      : (() => {
          throw new Error(
            "LISTFLOW_WORKER_ROLE must be unified or store-specific."
          );
        })()
    : storeFilters.length === 1
      ? "store-specific"
      : "unified";

  if (role === "unified" && storeFilters.length > 0) {
    throw new Error(
      "A unified worker must not set LISTFLOW_WORKER_STORE_LOGIN_ID."
    );
  }

  if (role === "store-specific" && storeFilters.length !== 1) {
    throw new Error(
      "A store-specific worker must set exactly one LISTFLOW_WORKER_STORE_LOGIN_ID."
    );
  }

  return role;
}

export function shouldDeferQueuedJob(input: {
  workerRole: WorkerRole;
  specialistOnline: boolean;
  createdAt: Date;
  now: Date;
  graceMs: number;
}) {
  return (
    input.workerRole === "unified" &&
    input.specialistOnline &&
    input.now.getTime() - input.createdAt.getTime() < input.graceMs
  );
}

export function rotateForRoundRobin<T>(items: T[], startIndex: number) {
  if (items.length <= 1) {
    return [...items];
  }

  const normalized = ((startIndex % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}
