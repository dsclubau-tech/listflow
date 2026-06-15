import "server-only";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const INTERNAL_USER_EMAIL = "store-session@listflow.local";
const INTERNAL_USER_NAME = "Store Session";

export type CurrentStoreSession = {
  storeId: string;
  storeName: string;
  storeLoginId: string;
};

export async function getCurrentStoreSession(): Promise<CurrentStoreSession | null> {
  const session = await auth();
  const storeId = session?.user?.storeId;

  if (!storeId) {
    return null;
  }

  return {
    storeId,
    storeName: session.user.storeName || session.user.name || "Store",
    storeLoginId: session.user.storeLoginId || session.user.email || storeId,
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
