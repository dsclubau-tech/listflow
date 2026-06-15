import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("price-check/tracked-products/route", "Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const products = await prisma.product.findMany({
      where: {
        storeId: storeSession.storeId,
        status: "IMPORTED",
        asin: { not: null },
        variants: { some: {} },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        asin: true,
        amazonPrice: true,
        ebayItemId: true,
        variants: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            buyPrice: true,
            sellPrice: true,
          },
        },
      },
    });

    return NextResponse.json(
      products.map((product) => ({
        id: product.id,
        title: product.title,
        asin: product.asin,
        amazonPrice: product.amazonPrice?.toString() ?? null,
        ebayItemId: product.ebayItemId,
        buyPrice: product.variants[0]?.buyPrice.toString() ?? "0.00",
        sellPrice: product.variants[0]?.sellPrice.toString() ?? "0.00",
      }))
    );
  } catch (error) {
    log.error(
      "price-check/tracked-products/route",
      "Failed to load tracked products",
      error
    );
    return NextResponse.json(
      { error: "Failed to load tracked products" },
      { status: 500 }
    );
  }
}
