export function getListingOperationRequestKey(jobId: string, productId: string) {
  return `${jobId}:${productId}`;
}
