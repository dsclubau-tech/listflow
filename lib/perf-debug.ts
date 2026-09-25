/** Lightweight, opt-in server timing. Never include arguments or query contents. */
const invocationCounts = new Map<string, number>();

export async function measureServerOperation<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.LISTFLOW_PERF_DEBUG !== "1") return operation();

  const invocation = (invocationCounts.get(name) ?? 0) + 1;
  invocationCounts.set(name, invocation);
  const started = performance.now();
  try {
    return await operation();
  } finally {
    console.info(`[listflow-perf] ${name} count=${invocation} durationMs=${Math.round(performance.now() - started)}`);
  }
}
