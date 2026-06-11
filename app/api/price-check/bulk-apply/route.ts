import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { reviseProductPrice } from "@/lib/price-checker";
import { createRequestLogger } from "@/lib/logger";

const EBAY_MIN_PRICE = 1.0;

interface ProductFailure {
  productId: string;
  title: string;
  error: string;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(numeric) ? numeric : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unexpected price review error";
}

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user) {
    log.warn("price-check/bulk-apply", "Unauthorized bulk apply attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse optional productIds filter from request body
  let filterProductIds: string[] | null = null;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      productIds?: unknown[];
    };

    if (Array.isArray(body.productIds) && body.productIds.length > 0) {
      filterProductIds = body.productIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean);
    }
  } catch {
    // No body or invalid JSON — apply to all pending
  }

  // Find pending price history entries, optionally filtered by productIds
  const pendingHistory = await prisma.priceHistory.findMany({
    where: {
      appliedAt: null,
      ...(filterProductIds && filterProductIds.length > 0
        ? { productId: { in: filterProductIds } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (pendingHistory.length === 0) {
    return NextResponse.json({
      total: 0,
      applied: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    });
  }

  // Group by productId
  const productGroups = new Map<
    string,
    (typeof pendingHistory)[number][]
  >();

  for (const entry of pendingHistory) {
    const existing = productGroups.get(entry.productId) ?? [];
    existing.push(entry);
    productGroups.set(entry.productId, existing);
  }

  const productIds = [...productGroups.keys()];
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  const failures: ProductFailure[] = [];

  // Process each product sequentially to avoid eBay rate limits
  for (const productId of productIds) {
    const historyItems = productGroups.get(productId)!;

    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          store: true,
          variants: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!product) {
        skipped += 1;
        continue;
      }

      if (product.status !== "IMPORTED") {
        skipped += 1;
        continue;
      }

      const historyByVariantId = new Map(
        historyItems
          .filter((item) => item.variantId)
          .map((item) => [item.variantId as string, item])
      );
      const variantsToUpdate = product.variants.filter((variant) =>
        historyByVariantId.has(variant.id)
      );

      if (variantsToUpdate.length === 0) {
        skipped += 1;
        continue;
      }

      const primaryVariant = product.variants[0] ?? null;
      const primaryHistory =
        (primaryVariant
          ? historyByVariantId.get(primaryVariant.id)
          : null) ?? historyByVariantId.get(variantsToUpdate[0].id);
      const nextPrimarySellPrice = decimalToNumber(
        primaryHistory?.newSellPrice
      );

      if (nextPrimarySellPrice === null) {
        skipped += 1;
        continue;
      }

      if (nextPrimarySellPrice < EBAY_MIN_PRICE) {
        failures.push({
          productId: product.id,
          title: product.title,
          error: `Sell price A$${nextPrimarySellPrice.toFixed(2)} is below eBay minimum of A$${EBAY_MIN_PRICE.toFixed(2)}`,
        });
        failed += 1;
        continue;
      }

      const reviewedAt = new Date();
      const historyIds = historyItems.map((item) => item.id);

      // Apply prices in a transaction
      await prisma.$transaction(async (tx) => {
        await Promise.all(
          variantsToUpdate.map((variant) => {
            const history = historyByVariantId.get(variant.id)!;

            return tx.variant.update({
              where: { id: variant.id },
              data: {
                buyPrice: history.newPrice,
                sellPrice: history.newSellPrice,
              },
            });
          })
        );

        await tx.product.update({
          where: { id: product.id },
          data: {
            price: primaryHistory!.newSellPrice,
            priceCheckError: null,
          },
        });

        await tx.priceHistory.updateMany({
          where: {
            id: { in: historyIds },
            appliedAt: null,
          },
          data: {
            appliedAt: reviewedAt,
            ebayRevised: false,
            errorMessage: null,
          },
        });
      });

      // Revise eBay listing
      let reviseResult: Awaited<ReturnType<typeof reviseProductPrice>>;

      try {
        reviseResult = await reviseProductPrice(
          {
            ...product,
            price: primaryHistory!.newSellPrice,
          },
          nextPrimarySellPrice
        );
      } catch (error) {
        reviseResult = {
          success: false,
          errorMessage: getErrorMessage(error),
        };
      }

      if (!reviseResult.success) {
        const errorMessage =
          reviseResult.errorMessage || "Failed to revise eBay listing.";

        await prisma.$transaction(async (tx) => {
          await tx.priceHistory.updateMany({
            where: { id: { in: historyIds } },
            data: {
              ebayRevised: false,
              errorMessage,
            },
          });

          await tx.product.update({
            where: { id: product.id },
            data: { priceCheckError: errorMessage },
          });
        });

        failures.push({
          productId: product.id,
          title: product.title,
          error: errorMessage,
        });
        failed += 1;
        continue;
      }

      // Mark as successfully revised
      await prisma.$transaction(async (tx) => {
        await tx.priceHistory.updateMany({
          where: { id: { in: historyIds } },
          data: {
            ebayRevised: true,
            errorMessage: null,
          },
        });

        await tx.product.update({
          where: { id: product.id },
          data: { priceCheckError: null },
        });
      });

      applied += 1;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      failures.push({
        productId,
        title: "(unknown)",
        error: errorMessage,
      });
      failed += 1;
    }
  }

  log.info("price-check/bulk-apply", "Bulk apply completed", {
    total: productIds.length,
    applied,
    failed,
    skipped,
  });

  return NextResponse.json({
    total: productIds.length,
    applied,
    failed,
    skipped,
    failures,
  });
}
