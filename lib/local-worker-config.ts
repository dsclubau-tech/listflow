export const DEFAULT_LOCAL_WORKER_STORE_LOGIN_IDS = [
  "store-1",
  "aussiewalmartonline",
  "oz-metro",
] as const;

export const LOCAL_WORKER_REPLICA_SLOTS = ["a", "b"] as const;

export const LOCAL_WORKER_RESTART_DELAYS_MS = [5_000, 15_000, 30_000] as const;

export type LocalWorkerStore = {
  id: string;
  name: string;
  loginId: string | null;
};

export type LocalWorkerDefinition = {
  storeId: string;
  storeLoginId: string;
  storeName: string;
  slot: (typeof LOCAL_WORKER_REPLICA_SLOTS)[number];
  workerId: string;
  workerName: string;
  logFileName: string;
  stopFileName: string;
};

export function sanitizeLocalWorkerId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseLocalWorkerStoreLoginIds(value: string | undefined) {
  const ids = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return ids && ids.length > 0
    ? Array.from(new Set(ids))
    : [...DEFAULT_LOCAL_WORKER_STORE_LOGIN_IDS];
}

export function buildLocalWorkerDefinitions(
  stores: LocalWorkerStore[],
  requestedLoginIds: string[],
  installationId?: string,
): LocalWorkerDefinition[] {
  const storesByLoginId = new Map(
    stores
      .filter((store): store is LocalWorkerStore & { loginId: string } =>
        Boolean(store.loginId),
      )
      .map((store) => [store.loginId, store]),
  );
  const missing = requestedLoginIds.filter((loginId) => !storesByLoginId.has(loginId));

  if (missing.length > 0) {
    throw new Error(
      `Active ListFlow stores were not found for: ${missing.join(", ")}. Check LISTFLOW_LOCAL_WORKER_STORE_LOGIN_IDS.`,
    );
  }

  const instance = installationId?.trim().toLowerCase();
  if (instance && !/^[a-z0-9-]{1,32}$/.test(instance)) {
    throw new Error("LISTFLOW_LOCAL_WORKER_INSTANCE_ID must use 1–32 lowercase letters, digits, or hyphens.");
  }

  return requestedLoginIds.flatMap((loginId) => {
    const store = storesByLoginId.get(loginId)!;
    const sanitizedLoginId = sanitizeLocalWorkerId(loginId);
    const prefix = instance ? `${instance}-` : "";

    return LOCAL_WORKER_REPLICA_SLOTS.map((slot) => {
      const workerId = `local-${prefix}${sanitizedLoginId}-${slot}`;
      const workerName = `${store.name} Local Worker ${slot.toUpperCase()}${instance ? ` (${instance})` : ""}`;

      return {
        storeId: store.id,
        storeLoginId: loginId,
        storeName: store.name,
        slot,
        workerId,
        workerName,
        logFileName: `worker-${prefix}${sanitizedLoginId}-${slot}.log`,
        stopFileName: `${workerId}.stop`,
      };
    });
  });
}

export function getLocalWorkerRestartDelay(attempt: number) {
  const index = Math.min(
    Math.max(0, attempt),
    LOCAL_WORKER_RESTART_DELAYS_MS.length - 1,
  );
  return LOCAL_WORKER_RESTART_DELAYS_MS[index];
}
