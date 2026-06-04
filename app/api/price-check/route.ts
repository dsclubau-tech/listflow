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

  let body: {
    productId?: string;
    productIds?: unknown[];
    all?: boolean;
    asins?: string[];
  };
  try {
    body = (await request.json()) as {
      productId?: string;
      productIds?: unknown[];
      all?: boolean;
      asins?: string[];
    };
  } catch (error) {
    log.error("price-check/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const productId = body.productId?.trim();
  const productIds = [
    ...new Set(
      [
        ...(productId ? [productId] : []),
        ...(Array.isArray(body.productIds)
          ? body.productIds.map((id) =>
              typeof id === "string" ? id.trim() : ""
            )
          : []),
      ].filter(Boolean)
    ),
  ];
  const rawAsins = Array.isArray(body.asins) ? body.asins : [];

  // Normalise ASINs: trim, uppercase, deduplicate, drop blanks
  const asins = [
    ...new Set(
      rawAsins
        .map((a) => (typeof a === "string" ? a.trim().toUpperCase() : ""))
        .filter(Boolean)
    ),
  ];

  if (!body.all && productIds.length === 0 && asins.length === 0) {
    return NextResponse.json(
      { error: "Either productId/productIds, all=true, or asins[] is required" },
      { status: 400 }
    );
  }

  // ── Bulk ASIN flow ────────────────────────────────────────────────────
  if (asins.length > 0) {
    const products = await prisma.product.findMany({
      where: {
        asin: { in: asins },
        status: "IMPORTED",
      },
      select: {
        id: true,
        asin: true,
        title: true,
        _count: { select: { variants: true } },
      },
    });

    // Only include products that have at least one variant
    const eligible = products.filter((p) => p._count.variants > 0);
    const matchedAsins = new Set(eligible.map((p) => p.asin!));
    const unmatched = asins.filter((a) => !matchedAsins.has(a));

    if (eligible.length === 0) {
      return NextResponse.json({
        checked: 0,
        changed: 0,
        pendingReview: 0,
        failed: 0,
        skipped: 0,
        reason: "No eligible products found for the supplied ASINs.",
        resolution: {
          matched: [],
          unmatched,
        },
      });
    }

    try {
      const result = await runPriceCheck({
        productIds: eligible.map((p) => p.id),
        ignoreSchedule: true,
      });

      log.info("price-check/route", "Bulk ASIN price check completed", {
        inputCount: asins.length,
        matchedCount: eligible.length,
        unmatchedCount: unmatched.length,
        result,
      });

      return NextResponse.json({
        ...result,
        resolution: {
          matched: eligible.map((p) => ({
            asin: p.asin,
            productId: p.id,
            title: p.title,
          })),
          unmatched,
        },
      });
    } catch (error) {
      log.error("price-check/route", "Bulk ASIN price check failed", error, {
        asins,
      });
      return NextResponse.json(
        { error: "Bulk price check failed" },
        { status: 500 }
      );
    }
  }

  // Targeted product flow.
  if (productIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        title: true,
        asin: true,
        status: true,
        _count: { select: { variants: true } },
      },
    });

    const foundIds = new Set(products.map((product) => product.id));
    const missingIds = productIds.filter((id) => !foundIds.has(id));
    const eligible = products.filter(
      (product) =>
        product.status === "IMPORTED" &&
        Boolean(product.asin) &&
        product._count.variants > 0
    );
    const eligibleIds = new Set(eligible.map((product) => product.id));
    const ineligibleIds = products
      .filter((product) => !eligibleIds.has(product.id))
      .map((product) => product.id);

    if (eligible.length === 0) {
      return NextResponse.json({
        checked: 0,
        changed: 0,
        pendingReview: 0,
        failed: 0,
        skipped: 0,
        reason: "No eligible tracked products found for the selected products.",
        resolution: {
          matched: [],
          unmatched: [...missingIds, ...ineligibleIds],
        },
      });
    }

    try {
      const result = await runPriceCheck({
        productIds: eligible.map((product) => product.id),
        ignoreSchedule: true,
      });

      log.info("price-check/route", "Targeted product price check completed", {
        requestedCount: productIds.length,
        matchedCount: eligible.length,
        unmatchedCount: missingIds.length + ineligibleIds.length,
        result,
      });

      return NextResponse.json({
        ...result,
        resolution: {
          matched: eligible.map((product) => ({
            asin: product.asin,
            productId: product.id,
            title: product.title,
          })),
          unmatched: [...missingIds, ...ineligibleIds],
        },
      });
    } catch (error) {
      log.error("price-check/route", "Targeted product price check failed", error, {
        productIds,
      });
      return NextResponse.json(
        { error: "Targeted price check failed" },
        { status: 500 }
      );
    }
  }

  try {
    const result = await runPriceCheck({
      ignoreSchedule: true,
    });

    log.info("price-check/route", "Manual price check completed", {
      all: Boolean(body.all),
      result,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("price-check/route", "Manual price check failed", error, {
      all: Boolean(body.all),
    });
    return NextResponse.json(
      { error: "Price check failed" },
      { status: 500 }
    );
  }
}
