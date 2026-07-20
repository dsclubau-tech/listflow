import "server-only";

import { ProductStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeAsin, isValidAsin } from "@/lib/price-check-eligibility";
import type { ExistingProductConflict } from "@/types/product-duplicate";

const DUPLICATE_STATUSES = [
  ProductStatus.DRAFT,
  ProductStatus.FAILED,
  ProductStatus.IMPORTED,
  ProductStatus.ON_HOLD,
] as const;

const STATUS_PRIORITY: Record<ProductStatus, number> = {
  [ProductStatus.IMPORTED]: 0,
  [ProductStatus.ON_HOLD]: 1,
  [ProductStatus.DRAFT]: 2,
  [ProductStatus.FAILED]: 3,
};

type DuplicateLookupClient = Pick<Prisma.TransactionClient, "product">;

export type ExistingAmazonProduct = {
  id: string;
  title: string;
  status: ProductStatus;
  ebayItemId: string | null;
  asin: string | null;
  updatedAt: Date;
};

export function getExistingAmazonProductLocation(status: ProductStatus) {
  return status === ProductStatus.DRAFT || status === ProductStatus.FAILED
    ? ("drafts" as const)
    : ("products" as const);
}

export function serializeExistingAmazonProduct(
  product: ExistingAmazonProduct,
): ExistingProductConflict {
  return {
    id: product.id,
    title: product.title,
    status: product.status,
    ebayItemId: product.ebayItemId,
    asin: product.asin,
    location: getExistingAmazonProductLocation(product.status),
  };
}

export function getDuplicateAmazonProductMessage(product: ExistingAmazonProduct) {
  if (
    product.status === ProductStatus.IMPORTED ||
    product.status === ProductStatus.ON_HOLD
  ) {
    return "This Amazon product is already uploaded to this store.";
  }

  if (product.status === ProductStatus.FAILED) {
    return "This Amazon product already exists as a failed draft. Open it and retry the existing draft.";
  }

  return "This Amazon product is already in Drafts.";
}

export function getDuplicateAmazonProductBody(product: ExistingAmazonProduct) {
  return {
    error: getDuplicateAmazonProductMessage(product),
    code: "DUPLICATE_ASIN" as const,
    existing: serializeExistingAmazonProduct(product),
  };
}

export class DuplicateAmazonProductError extends Error {
  readonly existing: ExistingAmazonProduct;

  constructor(existing: ExistingAmazonProduct) {
    super(getDuplicateAmazonProductMessage(existing));
    this.name = "DuplicateAmazonProductError";
    this.existing = existing;
  }
}

export async function findExistingAmazonProduct(
  storeId: string,
  asinValue: unknown,
  client: DuplicateLookupClient,
) {
  const asin = normalizeAsin(asinValue);

  if (!asin || !isValidAsin(asin)) {
    return null;
  }

  const matches = await client.product.findMany({
    where: {
      storeId,
      status: { in: [...DUPLICATE_STATUSES] },
      asin: { equals: asin, mode: "insensitive" },
    },
    select: {
      id: true,
      title: true,
      status: true,
      ebayItemId: true,
      asin: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  matches.sort((left, right) => {
    const priority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    return priority !== 0
      ? priority
      : right.updatedAt.getTime() - left.updatedAt.getTime();
  });

  return matches[0] ?? null;
}
