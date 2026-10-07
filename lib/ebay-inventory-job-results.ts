import type { InventoryAuthorization, InventoryPlan } from "./ebay-inventory";
export function deferredPriceHistoryIds(operations: Array<{ preparedPayload: unknown }>) {
    return new Set(operations.flatMap(operation => {
        const p = operation.preparedPayload as InventoryPlan;
        const authorization = p?.context?.authorization as InventoryAuthorization | undefined;
        return p?.kind === "ebay-inventory" && p.version === 2 && Array.isArray(p.targets) && authorization && ["EXPLICIT_EDIT", "PRICE_APPROVAL", "AUTOMATIC_POLICY"].includes(authorization.source)
            ? p.targets.filter(t => t.state === "DEFERRED" && !t.resolvedBy && !t.supersededBy).flatMap(t => (t.desired.priceHistoryIds ?? []).filter(id => authorization.historyIds?.includes(id))) : [];
    }));
}
export type InventoryJobError = {
    productId: string;
    title: string;
    error: string;
    retryEligible?: boolean;
    outcomeUncertain?: boolean;
    awaitingRestoration?: number;
    blockerCode?: string;
    variationResults?: Array<{
        state: string;
        supersededBy?: string;
        error?: string;
        errors?: Array<{ code: string; shortMessage?: string; longMessage?: string; message: string }>;
        target: {
            sku?: string;
            variantId?: string;
        };
    }>;
};
export function canRetryInventoryError(error: InventoryJobError) {
    return error.retryEligible !== false && !error.variationResults?.some(t => t.state === "DEFERRED") && !/listing has ended|fixedprice item ended|revise an ended item/i.test(error.error);
}
export function inventoryJobCounts(job: {
    failed: number;
    errors: InventoryJobError[];
}) {
    const unique = [...new Map(job.errors.map(e => [e.productId, e])).values()];
    const verification = unique.filter(e => e.outcomeUncertain === true).length;
    const awaitingRestoration = unique.filter(e => !e.outcomeUncertain && (e.variationResults ? e.variationResults.some(t => t.state === "DEFERRED" && !t.supersededBy) : Number(e.awaitingRestoration) > 0) && !e.variationResults?.some(t => t.state === "REJECTED")).length;
    const retryable = Math.max(0, job.failed - unique.filter(e => !canRetryInventoryError(e)).length);
    return { verification, awaitingRestoration, failed: Math.max(0, job.failed - verification - awaitingRestoration), retryable };
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
