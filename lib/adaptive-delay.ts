/**
 * Adaptive delay controller for rate-limited operations (e.g. Amazon scraping).
 *
 * Smoothly scales delay based on request latency and failures:
 * - On clean, fast responses: settles near minMs (or latency * latencyScale).
 * - On failures (timeouts, CAPTCHAs, HTTP errors): doubles delay up to maxMs (capped at 30s).
 * - After failures: gradually recovers delay back toward normal.
 */
export class AdaptiveDelay {
  private currentDelayMs: number;
  private consecutiveFailures = 0;

  constructor(
    private readonly minMs: number,
    private readonly maxMs: number,
    private readonly latencyScale = 1.5,
    private readonly backoffMultiplier = 2,
    private readonly recoveryRate = 0.8,
  ) {
    this.currentDelayMs = minMs;
  }

  /**
   * Call after a successful scrape.
   * @param latencyMs - Time taken by the scrape in milliseconds.
   */
  onSuccess(latencyMs: number): void {
    this.consecutiveFailures = 0;
    const target = Math.max(this.minMs, latencyMs * this.latencyScale);
    // Smooth blending toward the target to avoid sudden spikes/drops
    let nextDelay = this.currentDelayMs * this.recoveryRate + target * (1 - this.recoveryRate);
    if (Math.abs(nextDelay - target) < 10) {
      nextDelay = target;
    }
    this.currentDelayMs = Math.max(
      this.minMs,
      Math.min(this.maxMs, nextDelay),
    );
  }

  /**
   * Call after a scrape failure (timeout, CAPTCHA, HTTP error, price unavailable).
   */
  onFailure(): void {
    this.consecutiveFailures += 1;
    this.currentDelayMs = Math.min(
      this.maxMs,
      Math.max(this.minMs, this.currentDelayMs * this.backoffMultiplier),
    );
  }

  /** Current calculated delay in milliseconds (rounded to integer). */
  get delayMs(): number {
    return Math.round(this.currentDelayMs);
  }

  /** Number of consecutive failures. */
  get failures(): number {
    return this.consecutiveFailures;
  }
}
