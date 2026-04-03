import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runPriceCheck } from "@/lib/price-checker";
import { createRequestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user) {
    log.warn("price-check/route", "Unauthorized price check attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productId?: string; all?: boolean };
  try {
    body = (await request.json()) as { productId?: string; all?: boolean };
  } catch (error) {
    log.error("price-check/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const productId = body.productId?.trim();

  if (!body.all && !productId) {
    return NextResponse.json(
      { error: "Either productId or all=true is required" },
      { status: 400 }
    );
  }

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
  }

  try {
    const result = await runPriceCheck({
      productIds: productId ? [productId] : undefined,
      ignoreSchedule: true,
    });

    log.info("price-check/route", "Manual price check completed", {
      productId: productId ?? null,
      all: Boolean(body.all),
      result,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("price-check/route", "Manual price check failed", error, {
      productId: productId ?? null,
      all: Boolean(body.all),
    });
    return NextResponse.json(
      { error: "Price check failed" },
      { status: 500 }
    );
  }
}
