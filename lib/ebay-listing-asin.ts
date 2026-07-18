import "server-only";

import type { Prisma } from "@/app/generated/prisma/client";
import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";

type EbayListingAsinClient = Pick<Prisma.TransactionClient, "ebayListingAsin">;

export async function preserveEbayListingAsin(
  client: EbayListingAsinClient,
  input: {
    storeId: string;
    ebayItemId: string | null | undefined;
    asin: string | null | undefined;
  },
) {
  const ebayItemId = input.ebayItemId?.trim();
  const asin = normalizeAsin(input.asin);

  if (!ebayItemId || !asin || !isValidAsin(asin)) {
    return false;
  }

  await client.ebayListingAsin.upsert({
    where: {
      storeId_ebayItemId: {
        storeId: input.storeId,
        ebayItemId,
      },
    },
    update: { asin },
    create: {
      storeId: input.storeId,
      ebayItemId,
      asin,
    },
  });

  return true;
}
