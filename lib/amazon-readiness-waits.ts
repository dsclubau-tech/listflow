export type AmazonReadinessWaitResult = "signal" | "fallback";

export async function waitForAmazonReadinessOrFallback(input: {
  enabled: boolean;
  waitForSignal: () => Promise<boolean>;
  waitFallback: () => Promise<void>;
}): Promise<AmazonReadinessWaitResult> {
  if (input.enabled) {
    try {
      if (await input.waitForSignal()) return "signal";
    } catch {
      // An ambiguous signal uses the existing fixed-wait behavior.
    }
  }

  await input.waitFallback();
  return "fallback";
}
