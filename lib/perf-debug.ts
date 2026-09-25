/** Lightweight, opt-in server timing. Never include arguments or query contents. */
export async function measureServerOperation<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.LISTFLOW_PERF_DEBUG !== "1") return operation();

  const started = performance.now();
  try {
    return await operation();
  } finally {
    console.info(`[listflow-perf] ${name} ${Math.round(performance.now() - started)}ms`);
  }
}
