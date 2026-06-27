import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { reviseProductPrice } from "@/lib/price-checker";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidatePriceCaches } from "@/lib/cache-tags";

const EBAY_MIN_PRICE = 1.0;

interface ReviewRequestBody {
  priceHistoryId?: string;
  productId?: string;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(numeric) ? numeric : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected price review error";
}

async function findPendingHistoryTarget(body: ReviewRequestBody, storeId: string) {
  const priceHistoryId = body.priceHistoryId?.trim();
  const productId = body.productId?.trim();

  if (priceHistoryId) {
    const selectedHistory = await prisma.priceHistory.findFirst({
      where: {
        id: priceHistoryId,
        appliedAt: null,
        product: { storeId },
      },
    });

    if (!selectedHistory) {
      return null;
    }

    return prisma.priceHistory.findFirst({
      where: {
        productId: selectedHistory.productId,
        appliedAt: null,
        product: { storeId },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (productId) {
    return prisma.priceHistory.findFirst({
      where: {
        productId,
        appliedAt: null,
        product: { storeId },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("price-check/apply", "Unauthorized price apply attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ReviewRequestBody;

  try {
    body = (await request.json()) as ReviewRequestBody;
  } catch (error) {
    log.error("price-check/apply", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.priceHistoryId?.trim() && !body.productId?.trim()) {
    return NextResponse.json(
      { error: "priceHistoryId or productId is required" },
      { status: 400 }
    );
  }

  const target = await findPendingHistoryTarget(body, storeSession.storeId);

  if (!target) {
    return NextResponse.json(
      { error: "No pending price change was found" },
      { status: 404 }
    );
  }

  const [product, historyItems] = await Promise.all([
    prisma.product.findUnique({
      where: { id: target.productId },
      include: {
        store: true,
        variants: {
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.priceHistory.findMany({
      where: {
        productId: target.productId,
        createdAt: target.createdAt,
        appliedAt: null,
        product: { storeId: storeSession.storeId },
      },
    }),
  ]);

  if (!product || product.storeId !== storeSession.storeId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "IMPORTED") {
    return NextResponse.json(
      { error: "Only imported products can have price changes applied" },
      { status: 400 }
    );
  }

  if (historyItems.length === 0) {
    return NextResponse.json(
      { error: "The pending price change has already been reviewed" },
      { status: 409 }
    );
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
    return NextResponse.json(
      { error: "No active variants match this pending price change" },
      { status: 400 }
    );
  }

  const primaryVariant = product.variants[0] ?? null;
  const primaryHistory =
    (primaryVariant ? historyByVariantId.get(primaryVariant.id) : null) ??
    historyByVariantId.get(variantsToUpdate[0].id);
  const nextPrimarySellPrice = decimalToNumber(primaryHistory?.newSellPrice);

  if (nextPrimarySellPrice === null) {
    return NextResponse.json(
      { error: "Pending price change is missing a valid eBay sell price" },
      { status: 400 }
    );
  }

  if (nextPrimarySellPrice < EBAY_MIN_PRICE) {
    return NextResponse.json(
      {
        error:
          `Calculated sell price A$${nextPrimarySellPrice.toFixed(2)} is below ` +
          `eBay's minimum of A$${EBAY_MIN_PRICE.toFixed(2)}.`,
      },
      { status: 400 }
    );
  }

  const reviewedAt = new Date();
  const historyIds = historyItems.map((item) => item.id);

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

    await tx.priceHistory.updateMany({
      where: {
        productId: product.id,
        id: { notIn: historyIds },
        appliedAt: null,
        product: { storeId: storeSession.storeId },
      },
      data: {
        appliedAt: reviewedAt,
        ebayRevised: false,
        errorMessage: null,
      },
    });
  });

  let reviseResult: Awaited<ReturnType<typeof reviseProductPrice>>;

  try {
    reviseResult = await reviseProductPrice(
      {
        ...product,
        price: primaryHistory!.newSellPrice,
      },
      nextPrimarySellPrice,
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

    log.error(
      "price-check/apply",
      "Local price change applied, but eBay revise failed",
      undefined,
      {
        productId: product.id,
        ebayItemId: product.ebayItemId,
        errorMessage,
      }
    );

    invalidatePriceCaches(storeSession.storeId);

    return NextResponse.json(
      {
        error: `Local prices were applied, but eBay revise failed: ${errorMessage}`,
        applied: historyIds.length,
        ebayRevised: false,
      },
      { status: 502 }
    );
  }

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

  log.info("price-check/apply", "Pending price change applied", {
    productId: product.id,
    priceHistoryIds: historyIds,
    ebayItemId: product.ebayItemId,
  });

  invalidatePriceCaches(storeSession.storeId);

  return NextResponse.json({
    success: true,
    applied: historyIds.length,
    ebayRevised: true,
  });
}
