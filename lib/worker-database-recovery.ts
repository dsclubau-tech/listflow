export function isDatabaseConnectionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const detail = current as { code?: string; message?: string; cause?: unknown };
    if (["P1001", "P1002", "P1017", "P2024", "57P01", "53300"].includes(detail.code ?? "")) return true;
    if (/timeout exceeded when trying to connect|connection terminated unexpectedly|connection terminated due to connection timeout|can't reach database server|timed out fetching a new connection|too many clients|MaxClientsInSessionMode/i.test(detail.message ?? String(current))) return true;
    current = detail.cause;
  }
  return false;
}

// Only call recordFailure after the awaited store task has unwound. A failed
// heartbeat alone must never reset connections underneath an active listing.
export class WorkerDatabaseRecovery {
  private failures = 0;

  recordSuccess() {
    this.failures = 0;
  }

  recordFailure(error: unknown) {
    this.failures = isDatabaseConnectionError(error) ? this.failures + 1 : 0;
    return this.failures >= 3;
  }
}

export function createSingleFlightTask<T>(task: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(task).finally(() => { pending = null; });
    }
    return pending;
  };
}
