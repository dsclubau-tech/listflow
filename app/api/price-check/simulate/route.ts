import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runPriceCheck } from "@/lib/price-checker";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidatePriceCaches } from "@/lib/cache-tags";
import { isPriceCheckTrackableStatus } from "@/lib/price-check-eligibility";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("price-check/simulate/route", "Unauthorized simulation attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    productId?: string;
    simulatedPrice?: number;
  };

  try {
    body = (await request.json()) as {
      productId?: string;
      simulatedPrice?: number;
    };
  } catch (error) {
    log.error("price-check/simulate/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const productId = body.productId?.trim();
  const rawPrice =
    typeof body.simulatedPrice === "number"
      ? body.simulatedPrice
      : Number(body.simulatedPrice);
  const simulatedPrice = roundMoney(rawPrice);

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  if (!Number.isFinite(simulatedPrice) || simulatedPrice <= 0) {
    return NextResponse.json(
      { error: "simulatedPrice must be a positive number" },
      { status: 400 }
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      storeId: true,
      status: true,
      asin: true,
      amazonPrice: true,
      variants: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!product || product.storeId !== storeSession.storeId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!isPriceCheckTrackableStatus(product.status) || !product.asin) {
    return NextResponse.json(
      { error: "Product must be imported or on hold and have an ASIN" },
      { status: 400 }
    );
  }

  if (product.variants.length === 0) {
    return NextResponse.json(
      { error: "Product must have at least one variant" },
      { status: 400 }
    );
  }

  if (product.amazonPrice === null) {
    await prisma.product.update({
      where: { id: productId },
      data: {
        amazonPrice: simulatedPrice,
        lastPriceCheck: new Date(),
        priceCheckError: null,
        priceCheckFailureCode: null,
      },
    });

    log.info("price-check/simulate/route", "Baseline established via simulation", {
      productId,
      baselinePrice: simulatedPrice,
    });

    invalidatePriceCaches(storeSession.storeId);

    return NextResponse.json({
      checked: 1,
      changed: 0,
      pendingReview: 0,
      failed: 0,
      skipped: 1,
      reason:
        `Baseline established at A$${simulatedPrice.toFixed(2)}. ` +
        "Change the simulated price and run again to test the price change flow.",
    });
  }

  try {
    const result = await runPriceCheck({
      storeId: storeSession.storeId,
      productIds: [productId],
      ignoreSchedule: true,
      simulatedPrices: {
        [productId]: simulatedPrice,
      },
    });

    log.info("price-check/simulate/route", "Simulated price check completed", {
      productId,
      simulatedPrice,
      result,
    });

    invalidatePriceCaches(storeSession.storeId);

    return NextResponse.json(result);
  } catch (error) {
    log.error("price-check/simulate/route", "Simulated price check failed", error, {
      productId,
      simulatedPrice,
    });
    return NextResponse.json(
      { error: "Simulated price check failed" },
      { status: 500 }
    );
  }
}
