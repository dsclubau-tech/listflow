export type ActiveUploadJob = {
  id: string;
  productIds: string[];
};

export function partitionUploadProductIds(input: {
  requestedProductIds: string[];
  alreadyListedProductIds: string[];
  activeJobs: ActiveUploadJob[];
}) {
  const alreadyListed = new Set(input.alreadyListedProductIds);
  const active = new Set(
    input.activeJobs.flatMap((job) => job.productIds),
  );
  const activeProductIds: string[] = [];
  const queueProductIds: string[] = [];

  for (const productId of input.requestedProductIds) {
    if (alreadyListed.has(productId)) {
      continue;
    }

    if (active.has(productId)) {
      activeProductIds.push(productId);
    } else {
      queueProductIds.push(productId);
    }
  }

  return { activeProductIds, queueProductIds };
}
