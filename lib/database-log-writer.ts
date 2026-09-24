// Diagnostic logs must not queue unlimited database work during an outage.
// The caller still writes every entry to its local file/stdout.
export function createDatabaseLogWriter(options: {
  now?: () => number;
  cooldownMs?: number;
  onError: (error: unknown) => void;
}) {
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 30_000;
  let pending: Promise<void> | null = null;
  let retryAt = 0;
  let paused = false;
  const queue: Array<() => Promise<unknown>> = [];

  function drain(): Promise<void> {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      while (!paused && queue.length > 0) await queue.shift()!();
    }).catch((error) => {
      retryAt = now() + cooldownMs;
      queue.length = 0;
      options.onError(error);
    }).finally(() => {
      pending = null;
      if (!paused && queue.length > 0 && now() >= retryAt) void drain();
    });
    return pending;
  }

  return {
    async write(write: () => Promise<unknown>) {
      if (paused || now() < retryAt || queue.length >= 25) return;
      queue.push(write);
      await drain();
    },
    async pause() {
      paused = true;
      queue.length = 0;
      await pending;
    },
    resume() {
      paused = false;
    },
  };
}
