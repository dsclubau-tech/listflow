import "server-only";

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type DeleteProductsInput = {
  storeId: string;
  productIds: string[];
};

function normalizeProductIds(productIds: string[]) {
  return Array.from(
    new Set(
      productIds
        .map((productId) => productId.trim())
        .filter((productId) => productId.length > 0)
    )
  );
}

export async function deleteProductsFromListflow({
  storeId,
  productIds,
}: DeleteProductsInput) {
  const normalizedIds = normalizeProductIds(productIds);

  if (normalizedIds.length === 0) {
    return {
      requestedCount: 0,
      deletedProducts: 0,
      deletedVariants: 0,
      deletedPriceHistory: 0,
      deletedUploadLogs: 0,
    };
  }

  const productWhere = {
    id: { in: normalizedIds },
    storeId,
  } satisfies Prisma.ProductWhereInput;

  const [uploadLogs, priceHistory, variants, products] =
    await prisma.$transaction([
      prisma.uploadLog.deleteMany({
        where: { product: { is: productWhere } },
      }),
      prisma.priceHistory.deleteMany({
        where: { product: { is: productWhere } },
      }),
      prisma.variant.deleteMany({
        where: { product: { is: productWhere } },
      }),
      prisma.product.deleteMany({
        where: productWhere,
      }),
    ]);

  return {
    requestedCount: normalizedIds.length,
    deletedProducts: products.count,
    deletedVariants: variants.count,
    deletedPriceHistory: priceHistory.count,
    deletedUploadLogs: uploadLogs.count,
  };
}

export async function deleteProductFromListflow(storeId: string, productId: string) {
  return deleteProductsFromListflow({ storeId, productIds: [productId] });
}
