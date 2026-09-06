import "server-only";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getOrRefreshEntitlement } from "@/lib/aa-entitlement";

const INTERNAL_USER_EMAIL = "store-session@listflow.local";
const INTERNAL_USER_NAME = "Store Session";

export type CurrentStoreSession = {
  storeId: string;
  storeName: string;
  storeLoginId: string;
  ownerUserId?: string;
};

export type StoreWithRanking = {
  id: string;
  name: string;
  loginId: string | null;
  createdAt: Date;
  rank: number;
  isEntitled: boolean;
};

/**
 * Returns all active stores for a customer with 1-based rank by createdAt ASC
 * and whether each store is within the customer's allowedStores limit.
 */
export async function getUserStoresWithRanking(userId: string): Promise<{
  stores: StoreWithRanking[];
  allowedStores: number;
  entitlementStatus: string;
}> {
  const stores = await prisma.store.findMany({
    where: { ownerUserId: userId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, loginId: true, createdAt: true },
  });

  const entitlement = await getOrRefreshEntitlement(userId);
  const allowedStores = entitlement.status === "ACTIVE" ? entitlement.allowedStores : 0;

  const storesWithRanking: StoreWithRanking[] = stores.map((store, index) => {
    const rank = index + 1;
    return {
      id: store.id,
      name: store.name,
      loginId: store.loginId,
      createdAt: store.createdAt,
      rank,
      isEntitled: rank <= allowedStores,
    };
  });

  return {
    stores: storesWithRanking,
    allowedStores,
    entitlementStatus: entitlement.status,
  };
}

/**
 * Authoritative store session resolver.
 * 1. Checks authenticated AA Supabase user.
 * 2. Checks local PostgreSQL EntitlementSnapshot (15-min cache lease).
 * 3. Enforces per-store ranking (createdAt ASC, rank <= allowedStores).
 * 4. Selects active store from cookie if entitled, else defaults to rank 1 store.
 */
export async function getCurrentStoreSession(): Promise<CurrentStoreSession | null> {
  // 1. Try Supabase Auth user first
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      const { stores, allowedStores, entitlementStatus } =
        await getUserStoresWithRanking(user.id);

      if (entitlementStatus !== "ACTIVE" || allowedStores <= 0 || stores.length === 0) {
        return null;
      }

      const entitledStores = stores.filter((s) => s.isEntitled);
      if (entitledStores.length === 0) {
        return null;
      }

      // Check cookie for selected store
      const cookieStore = await cookies();
      const activeStoreId = cookieStore.get("listflow_active_store_id")?.value;

      let selected = entitledStores.find((s) => s.id === activeStoreId);
      if (!selected) {
        selected = entitledStores[0]; // Fallback to rank 1 store
      }

      return {
        storeId: selected.id,
        storeName: selected.name,
        storeLoginId: selected.loginId || selected.id,
        ownerUserId: user.id,
      };
    }
  } catch {
    // If Supabase check fails, fallback to legacy session check below
  }

  // 2. Fallback to legacy NextAuth session if available
  const session = await auth();
  const storeId = session?.user?.storeId;

  if (!storeId) {
    return null;
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      name: true,
      loginId: true,
      isActive: true,
      ownerUserId: true,
    },
  });

  if (!store?.isActive) {
    return null;
  }

  // If store is linked to an AA owner, enforce entitlement
  if (store.ownerUserId) {
    const entitlement = await getOrRefreshEntitlement(store.ownerUserId);
    if (entitlement.status !== "ACTIVE" || entitlement.allowedStores <= 0) {
      return null;
    }
  }

  return {
    storeId,
    storeName: store.name,
    storeLoginId:
      store.loginId ||
      session.user.storeLoginId ||
      session.user.email ||
      storeId,
    ownerUserId: store.ownerUserId ?? undefined,
  };
}

export async function getInternalUserId() {
  const existing = await prisma.user.findUnique({
    where: { email: INTERNAL_USER_EMAIL },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const password = await bcrypt.hash(
    process.env.INTERNAL_STORE_SESSION_PASSWORD || "store-session-disabled",
    12
  );

  const user = await prisma.user.create({
    data: {
      name: INTERNAL_USER_NAME,
      email: INTERNAL_USER_EMAIL,
      password,
      role: "store",
    },
    select: { id: true },
  });

  return user.id;
}

export function isOwnedStore(storeId: string | null | undefined, session: CurrentStoreSession) {
  return storeId === session.storeId;
}
