import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidatePriceCaches } from "@/lib/cache-tags";

interface ReviewRequestBody {
  priceHistoryId?: string;
  productId?: string;
}

async function findPendingHistoryTarget(body: ReviewRequestBody, storeId: string) {
  const priceHistoryId = body.priceHistoryId?.trim();
  const productId = body.productId?.trim();

  if (priceHistoryId) {
    return prisma.priceHistory.findFirst({
      where: {
        id: priceHistoryId,
        appliedAt: null,
        product: { storeId },
      },
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
    log.warn("price-check/dismiss", "Unauthorized price dismiss attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ReviewRequestBody;

  try {
    body = (await request.json()) as ReviewRequestBody;
  } catch (error) {
    log.error("price-check/dismiss", "Invalid JSON body", error);
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

  const targetHistoryItems = await prisma.priceHistory.findMany({
    where: {
      productId: target.productId,
      createdAt: target.createdAt,
      appliedAt: null,
      product: { storeId: storeSession.storeId },
    },
    select: { id: true },
  });

  if (targetHistoryItems.length === 0) {
    return NextResponse.json(
      { error: "The pending price change has already been reviewed" },
      { status: 409 }
    );
  }

  const pendingProductHistory = await prisma.priceHistory.findMany({
    where: {
      productId: target.productId,
      appliedAt: null,
      product: { storeId: storeSession.storeId },
    },
    select: { id: true },
  });
  const historyIds = pendingProductHistory.map((item) => item.id);
  const reviewedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.priceHistory.updateMany({
      where: {
        productId: target.productId,
        appliedAt: null,
        product: { storeId: storeSession.storeId },
      },
      data: {
        appliedAt: reviewedAt,
        ebayRevised: false,
        errorMessage: null,
      },
    });

    await tx.product.update({
      where: { id: target.productId },
      data: { priceCheckError: null },
    });
  });

  log.info("price-check/dismiss", "Pending price change dismissed", {
    productId: target.productId,
    priceHistoryIds: historyIds,
  });

  invalidatePriceCaches(storeSession.storeId);

  return NextResponse.json({
    success: true,
    dismissed: historyIds.length,
  });
}
