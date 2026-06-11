import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user) {
    log.warn("price-check/bulk-dismiss", "Unauthorized bulk dismiss attempt");
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
    // No body or invalid JSON — dismiss all pending
  }

  const pendingHistory = await prisma.priceHistory.findMany({
    where: {
      appliedAt: null,
      ...(filterProductIds && filterProductIds.length > 0
        ? { productId: { in: filterProductIds } }
        : {}),
    },
    select: { id: true, productId: true },
  });

  if (pendingHistory.length === 0) {
    return NextResponse.json({ dismissed: 0 });
  }

  const historyIds = pendingHistory.map((item) => item.id);
  const affectedProductIds = [
    ...new Set(pendingHistory.map((item) => item.productId)),
  ];
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

    await tx.product.updateMany({
      where: { id: { in: affectedProductIds } },
      data: { priceCheckError: null },
    });
  });

  log.info("price-check/bulk-dismiss", "Bulk dismiss completed", {
    dismissed: historyIds.length,
    affectedProducts: affectedProductIds.length,
  });

  return NextResponse.json({
    dismissed: historyIds.length,
  });
}
