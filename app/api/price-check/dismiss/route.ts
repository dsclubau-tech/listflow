import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

interface ReviewRequestBody {
  priceHistoryId?: string;
  productId?: string;
}

async function findPendingHistoryTarget(body: ReviewRequestBody) {
  const priceHistoryId = body.priceHistoryId?.trim();
  const productId = body.productId?.trim();

  if (priceHistoryId) {
    return prisma.priceHistory.findFirst({
      where: {
        id: priceHistoryId,
        appliedAt: null,
      },
    });
  }

  if (productId) {
    return prisma.priceHistory.findFirst({
      where: {
        productId,
        appliedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user) {
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

  const target = await findPendingHistoryTarget(body);

  if (!target) {
    return NextResponse.json(
      { error: "No pending price change was found" },
      { status: 404 }
    );
  }

  const historyItems = await prisma.priceHistory.findMany({
    where: {
      productId: target.productId,
      createdAt: target.createdAt,
      appliedAt: null,
    },
    select: { id: true },
  });

  if (historyItems.length === 0) {
    return NextResponse.json(
      { error: "The pending price change has already been reviewed" },
      { status: 409 }
    );
  }

  const historyIds = historyItems.map((item) => item.id);
  const reviewedAt = new Date();

  await prisma.$transaction(async (tx) => {
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

    await tx.product.update({
      where: { id: target.productId },
      data: { priceCheckError: null },
    });
  });

  log.info("price-check/dismiss", "Pending price change dismissed", {
    productId: target.productId,
    priceHistoryIds: historyIds,
  });

  return NextResponse.json({
    success: true,
    dismissed: historyIds.length,
  });
}
