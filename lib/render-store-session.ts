import "server-only";

import { cache } from "react";
import { getOrRefreshEntitlement } from "@/lib/aa-entitlement";
import { measureServerOperation } from "@/lib/perf-debug";
import {
  getCurrentStoreSessionWithReaders,
  getLegacySession,
  getSupabaseUserId,
  getUserStoresWithRanking,
} from "@/lib/store-session";

// React discards these results after each server render. API routes and workers
// continue to use the uncached readers in store-session.ts.
export const getRenderSupabaseUserId = cache(getSupabaseUserId);
export const getRenderLegacySession = cache(getLegacySession);
export const getRenderEntitlement = cache((userId: string) =>
  measureServerOperation("store.entitlement", () => getOrRefreshEntitlement(userId))
);
export const getRenderStores = cache((userId: string) =>
  getUserStoresWithRanking(userId, getRenderEntitlement)
);
export const getRenderCurrentStoreSession = cache(() =>
  getCurrentStoreSessionWithReaders({
    getSupabaseUserId: getRenderSupabaseUserId,
    getLegacySession: getRenderLegacySession,
    getEntitlement: getRenderEntitlement,
    getStores: getRenderStores,
  })
);
