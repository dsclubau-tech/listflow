import "server-only";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cacheLife, cacheTag } from "next/cache";
import {
  LISTFLOW_FRESH_CACHE_LIFE,
  storeCacheTag,
} from "@/lib/cache-tags";

const INTERNAL_USER_EMAIL = "store-session@listflow.local";
const INTERNAL_USER_NAME = "Store Session";

export type CurrentStoreSession = {
  storeId: string;
  storeName: string;
  storeLoginId: string;
};

async function getCachedStoreIdentity(storeId: string) {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(storeCacheTag(storeId));

  return prisma.store.findUnique({
    where: { id: storeId },
    select: {
      name: true,
      loginId: true,
      isActive: true,
    },
  });
}

export async function getCurrentStoreSession(): Promise<CurrentStoreSession | null> {
  const session = await auth();
  const storeId = session?.user?.storeId;

  if (!storeId) {
    return null;
  }

  const store = await getCachedStoreIdentity(storeId);

  if (!store?.isActive) {
    return null;
  }

  return {
    storeId,
    storeName: store.name,
    storeLoginId:
      store.loginId ||
      session.user.storeLoginId ||
      session.user.email ||
      storeId,
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
