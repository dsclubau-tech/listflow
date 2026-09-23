export type SchedulableJob = { trigger: "MANUAL" | "AUTOMATIC" };

export function orderPriceCheckJobs<M extends SchedulableJob, A extends SchedulableJob>(
  manual: M[], automatic: A[], manualStreak: number, manualBurst = 10,
) {
  return manualStreak >= manualBurst
    ? [...automatic, ...manual]
    : [...manual, ...automatic];
}

export function canClaimProduct(productId: string, lockedProductIds: ReadonlySet<string>) {
  return !lockedProductIds.has(productId);
}
