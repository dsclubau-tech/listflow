import { ProductStatus } from "@/app/generated/prisma/enums";

export type StockReplenishmentProduct = {
  id: string;
  title: string;
  ebayItemId: string | null;
  quantity: number;
  status: ProductStatus | string;
  variantCount?: number;
};

export type StockReplenishmentListing = {
  itemId: string;
  title?: string;
  quantityAvailable: number;
};

export type StockReplenishmentCandidate = {
  productId: string;
  ebayItemId: string;
  title: string;
  ebayQuantity: number;
  targetQuantity: number;
};

function normalizeItemId(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function getStockReplenishmentCandidates(
  products: StockReplenishmentProduct[],
  listings: StockReplenishmentListing[],
): StockReplenishmentCandidate[] {
  const listingsByItemId = new Map(
    listings.map((listing) => [normalizeItemId(listing.itemId), listing]),
  );

  return products.flatMap((product) => {
    const ebayItemId = normalizeItemId(product.ebayItemId);
    const targetQuantity = Math.floor(product.quantity);
    const listing = listingsByItemId.get(ebayItemId);

    if (
      product.status !== ProductStatus.IMPORTED ||
      !ebayItemId ||
      !listing ||
      targetQuantity <= 0 ||
      (product.variantCount ?? 1) > 1
    ) {
      return [];
    }

    const ebayQuantity = Math.max(0, Math.floor(listing.quantityAvailable));
    if (ebayQuantity >= targetQuantity) {
      return [];
    }

    return [
      {
        productId: product.id,
        ebayItemId,
        title: product.title,
        ebayQuantity,
        targetQuantity,
      },
    ];
  });
}
