import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  draftsCacheTag,
  LISTFLOW_FRESH_CACHE_LIFE,
  productsCacheTag,
} from "@/lib/cache-tags";
import { prisma } from "@/lib/prisma";
import type { SerializedProductRow } from "@/types/product-row";

export async function getCachedDraftsPageData(storeId: string) {
  "use cache";

  cacheLife(LISTFLOW_FRESH_CACHE_LIFE);
  cacheTag(draftsCacheTag(storeId), productsCacheTag(storeId));

  const products = await prisma.product.findMany({
    where: {
      storeId,
      status: {
        in: ["DRAFT", "FAILED"],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      store: true,
      createdBy: true,
    },
  });

  const serializedProducts: SerializedProductRow[] = products.map((product) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    store: {
      ...product.store,
      createdAt: product.store.createdAt.toISOString(),
      updatedAt: product.store.updatedAt.toISOString(),
    },
    createdBy: {
      ...product.createdBy,
      createdAt: product.createdBy.createdAt.toISOString(),
      updatedAt: product.createdBy.updatedAt.toISOString(),
    },
  }));

  return { products: serializedProducts };
}
