import { ProductStatus } from "@/app/generated/prisma/client";
import { auth } from "@/auth";
import {
  MAX_BULK_ASIN_MAPPINGS,
  resolveBulkAsinMappings,
  validateBulkAsinMappings,
} from "@/lib/bulk-asin-link";
import { invalidatePriceCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { preserveEbayListingAsin } from "@/lib/ebay-listing-asin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    log.error("products/bulk-link-asins", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedStoreId =
    body && typeof body === "object" && "storeId" in body
      ? String((body as { storeId?: unknown }).storeId ?? "").trim()
      : storeSession.storeId;
  const rawMappings =
    body && typeof body === "object" && "mappings" in body
      ? (body as { mappings?: unknown }).mappings
      : undefined;

  if (requestedStoreId !== storeSession.storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  if (Array.isArray(rawMappings) && rawMappings.length > MAX_BULK_ASIN_MAPPINGS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_BULK_ASIN_MAPPINGS} ASIN mappings can be linked at once.` },
      { status: 400 },
    );
  }

  const validation = validateBulkAsinMappings(rawMappings);

  if (validation.mappings.length === 0) {
    return NextResponse.json(
      {
        error: "Add at least one valid eBay item ID or SKU and ASIN mapping.",
        invalid: validation.invalid,
      },
      { status: 400 },
    );
  }

  const identifiers = validation.mappings.map((mapping) => mapping.identifier);
  const candidates = await prisma.product.findMany({
    where: {
      storeId: storeSession.storeId,
      status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
      OR: [
        { ebayItemId: { in: identifiers } },
        {
          variants: {
            some: { sku: { in: identifiers, mode: "insensitive" } },
          },
        },
      ],
    },
    select: {
      id: true,
      ebayItemId: true,
      variants: { select: { sku: true } },
    },
  });
  const resolution = resolveBulkAsinMappings(candidates, validation.mappings);

  if (resolution.updates.length > 0) {
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    await prisma.$transaction(async (tx) => {
      for (const update of resolution.updates) {
        await tx.product.update({
          where: { id: update.productId },
          data: {
            asin: update.asin,
            priceCheckError: null,
            priceCheckFailureCode: null,
            lastPriceCheck: null,
          },
        });

        await preserveEbayListingAsin(tx, {
          storeId: storeSession.storeId,
          ebayItemId: candidateById.get(update.productId)?.ebayItemId,
          asin: update.asin,
        });
      }
    });

    invalidateProductCaches(storeSession.storeId);
    invalidatePriceCaches(storeSession.storeId);
  }

  log.info("products/bulk-link-asins", "Bulk ASIN link completed", {
    requested: Array.isArray(rawMappings) ? rawMappings.length : 0,
    updated: resolution.updates.length,
    invalid: validation.invalid.length,
    unmatched: resolution.unmatched.length,
    ambiguous: resolution.ambiguous.length,
  });

  return NextResponse.json({
    updated: resolution.updates.length,
    matched: resolution.updates,
    invalid: validation.invalid,
    unmatched: resolution.unmatched,
    ambiguous: resolution.ambiguous,
  });
}
