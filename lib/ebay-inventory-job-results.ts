export type InventoryJobError = {
    productId: string;
    title: string;
    error: string;
    retryEligible?: boolean;
    outcomeUncertain?: boolean;
    variationResults?: Array<{
        state: string;
        error?: string;
        target: {
            sku?: string;
            variantId?: string;
        };
    }>;
};
export function canRetryInventoryError(error: InventoryJobError) {
    return error.retryEligible !== false && !/listing has ended|fixedprice item ended|revise an ended item/i.test(error.error);
}
export function inventoryJobCounts(job: {
    failed: number;
    errors: InventoryJobError[];
}) {
    const unique = [...new Map(job.errors.map(e => [e.productId, e])).values()];
    const verification = unique.filter(e => e.outcomeUncertain === true).length;
    const retryable = Math.max(0, job.failed - unique.filter(e => !canRetryInventoryError(e)).length);
    return { verification, failed: Math.max(0, job.failed - verification), retryable };
}
export function prepareInventoryJobRetry(job: {
    completedProductIds: string[];
    succeeded: number;
    failed: number;
    errors: InventoryJobError[];
}, eligibleIds: string[], selectedIds?: string[]) {
    const errors = new Map(job.errors.map(e => [e.productId, e]));
    const ids = [...new Set(eligibleIds)].filter(id => (!selectedIds || selectedIds.includes(id)) && (!errors.has(id) || canRetryInventoryError(errors.get(id)!)));
    return { ids, completed: job.completedProductIds.filter(id => !ids.includes(id)), succeeded: job.succeeded, failed: Math.max(0, job.failed - ids.length), errors: job.errors.filter(e => !ids.includes(e.productId)) };
}
