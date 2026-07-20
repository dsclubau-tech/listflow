import "server-only";

import { revalidateTag } from "next/cache";

export const LISTFLOW_FRESH_CACHE_LIFE = {
  stale: 5,
  revalidate: 10,
  expire: 30,
} as const;

export type ListflowCacheScope =
  | "store"
  | "products"
  | "drafts"
  | "actionCenter"
  | "jobs";

function listflowTag(scope: ListflowCacheScope, storeId: string) {
  return `listflow:${scope}:${storeId}`;
}

export function storeCacheTag(storeId: string) {
  return listflowTag("store", storeId);
}

export function productsCacheTag(storeId: string) {
  return listflowTag("products", storeId);
}

export function draftsCacheTag(storeId: string) {
  return listflowTag("drafts", storeId);
}

export function actionCenterCacheTag(storeId: string) {
  return listflowTag("actionCenter", storeId);
}

export function jobsCacheTag(storeId: string) {
  return listflowTag("jobs", storeId);
}

function tagForScope(scope: ListflowCacheScope, storeId: string) {
  switch (scope) {
    case "store":
      return storeCacheTag(storeId);
    case "products":
      return productsCacheTag(storeId);
    case "drafts":
      return draftsCacheTag(storeId);
    case "actionCenter":
      return actionCenterCacheTag(storeId);
    case "jobs":
      return jobsCacheTag(storeId);
  }
}

export function invalidateListflowTags(tags: string[]) {
  for (const tag of new Set(tags.filter(Boolean))) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      // Worker scripts run outside the Next.js request runtime. The short
      // cache lifetime is the fallback when immediate tag invalidation is unavailable.
    }
  }
}

export function invalidateStoreCaches(
  storeId: string,
  scopes: ListflowCacheScope[],
) {
  invalidateListflowTags(scopes.map((scope) => tagForScope(scope, storeId)));
}

export function invalidateProductCaches(storeId: string) {
  invalidateStoreCaches(storeId, [
    "products",
    "drafts",
    "actionCenter",
  ]);
}

export function invalidateDraftCaches(storeId: string) {
  invalidateStoreCaches(storeId, ["drafts", "products", "actionCenter"]);
}

export function invalidatePriceCaches(storeId: string) {
  invalidateStoreCaches(storeId, ["products", "actionCenter"]);
}

export function invalidateJobCaches(storeId: string) {
  invalidateStoreCaches(storeId, ["jobs", "actionCenter"]);
}

export function invalidateAllStoreCaches(storeId: string) {
  invalidateStoreCaches(storeId, [
    "store",
    "products",
    "drafts",
    "actionCenter",
    "jobs",
  ]);
}
