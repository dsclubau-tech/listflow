import "server-only";

import {
  EbayActionJobType,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { prisma } from "@/lib/prisma";
import { getAutomaticSku } from "@/lib/sku";
import { getOrCreateStoreSupplierSettings } from "@/lib/supplier-settings";

type BackfillMissingListingSkusInput = {
  storeId: string;
  userId: string;
};

export async function backfillMissingListingSkus(
  input: BackfillMissingListingSkusInput,
) {
  const settings = await getOrCreateStoreSupplierSettings(input.storeId);
  if (!settings.automaticSkuFilling) {
    await prisma.supplierSettings.update({
      where: { id: settings.id },
      data: { automaticSkuFilling: true },
    });
  }

  const products = await prisma.product.findMany({
    where: {
      storeId: input.storeId,
      status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
      ebayItemId: { not: null },
    },
    select: {
      id: true,
      asin: true,
      variants: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, sku: true },
      },
    },
  });

  const candidates = products.flatMap((product) => {
    const variant = product.variants[0];
    const sku = getAutomaticSku({
      asin: product.asin,
      automaticSkuFilling: true,
    });

    if (!variant || variant.sku?.trim() || !sku) {
      return [];
    }

    return [
      {
        productId: product.id,
        variantId: variant.id,
        previousSku: variant.sku,
        sku,
      },
    ];
  });

  if (candidates.length === 0) {
    return {
      automaticSkuFilling: true,
      updated: 0,
      skipped: products.filter((product) => !product.variants[0]).length,
      queued: false,
      job: null,
    };
  }

  const updatedProductIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const candidate of candidates) {
      const result = await tx.variant.updateMany({
        where: {
          id: candidate.variantId,
          sku: candidate.previousSku,
        },
        data: { sku: candidate.sku },
      });

      if (result.count > 0) {
        updatedProductIds.push(candidate.productId);
      }
    }
  });

  const jobResult =
    updatedProductIds.length > 0
      ? await createEbayActionJob({
          userId: input.userId,
          storeId: input.storeId,
          type: EbayActionJobType.BULK_EDIT_REVISE,
          productIds: updatedProductIds,
          metadata: {
            kind: "bulk-edit",
            fields: ["sku"],
            source: "missing-sku-backfill",
          },
        })
      : { queued: false as const, job: null };

  return {
    automaticSkuFilling: true,
    updated: updatedProductIds.length,
    skipped: candidates.length - updatedProductIds.length,
    ...jobResult,
  };
}
