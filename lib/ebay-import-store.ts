import "server-only";

import { getStoreCredentials, getStoreNumber } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";

export async function resolveEbayImportStore(storeId: string) {
  if (!storeId) {
    throw new Error("storeId is required");
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, isActive: true },
  });

  if (!store || !store.isActive) {
    throw new Error("Store not found");
  }

  const storeNumber = await getStoreNumber(storeId);
  const credentials = getStoreCredentials(storeNumber);

  if (!credentials.refreshToken) {
    throw new Error(`${store.name} has no eBay token configured`);
  }

  return { store, storeNumber };
}
