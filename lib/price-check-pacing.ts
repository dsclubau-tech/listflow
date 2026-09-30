type Environment = Record<string, string | undefined>;

export function resolvePriceCheckProductPacing(environment: Environment = process.env) {
  const read = (name: string, fallback: number) => {
    const value = Number.parseInt(environment[name] ?? "", 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const minMs = Math.max(1000, read("LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MIN_MS", 3000));
  const maxMs = Math.max(minMs, read("LISTFLOW_PRICE_CHECK_PRODUCT_DELAY_MAX_MS", 7000));
  return { minMs, maxMs };
}

export function getPriceCheckProductDelayMs(
  pacing: ReturnType<typeof resolvePriceCheckProductPacing>,
  random: () => number = Math.random,
) {
  return pacing.minMs + random() * (pacing.maxMs - pacing.minMs);
}
