import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildEndItemXML } from "@/lib/ebay-xml";
import { callEbayEndItem, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { ProductStatus } from "@/app/generated/prisma/enums";

const ENDABLE_STATUSES: ProductStatus[] = [
  ProductStatus.IMPORTED,
  ProductStatus.ON_HOLD,
];

interface ProductFailure {
  productId: string;
  title: string;
  error: string;
}

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user) {
    log.warn("products/bulk-end", "Unauthorized bulk end attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let productIds: string[] = [];
  try {
    const body = (await request.json().catch(() => ({}))) as {
      productIds?: unknown[];
    };
    if (Array.isArray(body.productIds)) {
      productIds = Array.from(
        new Set(
          body.productIds
            .map((id) => (typeof id === "string" ? id.trim() : ""))
            .filter(Boolean)
        )
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (productIds.length === 0) {
    return NextResponse.json({
      total: 0,
      ended: 0,
      failed: 0,
      failures: [],
    });
  }

  let ended = 0;
  let failed = 0;
  const failures: ProductFailure[] = [];

  // Process sequentially to prevent eBay rate limits
  for (const productId of productIds) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        failures.push({
          productId,
          title: "(missing)",
          error: "Product was not found",
        });
        failed += 1;
        continue;
      }

      if (!ENDABLE_STATUSES.includes(product.status) || !product.ebayItemId) {
        failures.push({
          productId: product.id,
          title: product.title,
          error: "Product is not listed on eBay or lacks an eBay Item ID",
        });
        failed += 1;
        continue;
      }

      const storeNumber = await getStoreNumber(product.storeId);
      const xml = buildEndItemXML(product.ebayItemId);

      log.info("products/bulk-end", "Ending listing on eBay", {
        productId,
        ebayItemId: product.ebayItemId,
      });

      const result = await callEbayEndItem(xml, storeNumber);

      const isAlreadyEnded =
        result.errorMessage?.toLowerCase().includes("already ended") ||
        result.errorMessage?.toLowerCase().includes("invalid item") ||
        result.errorMessage?.toLowerCase().includes("does not exist") ||
        result.errorMessage?.toLowerCase().includes("not found");

      if (result.success || isAlreadyEnded) {
        log.info("products/bulk-end", "eBay EndItem succeeded (or already ended), deleting product from database", {
          productId,
          ebayItemId: product.ebayItemId,
        });

        // Delete from ListFlow (delete related rows first to satisfy foreign keys)
        await prisma.$transaction([
          prisma.uploadLog.deleteMany({ where: { productId: product.id } }),
          prisma.variant.deleteMany({ where: { productId: product.id } }),
          prisma.priceHistory.deleteMany({ where: { productId: product.id } }),
          prisma.product.delete({ where: { id: product.id } }),
        ]);

        ended += 1;
      } else {
        const errorMsg = result.errorMessage || "Unknown eBay API error";
        log.error("products/bulk-end", "eBay EndItem failed", undefined, {
          productId,
          ebayItemId: product.ebayItemId,
          error: errorMsg,
        });

        failures.push({
          productId: product.id,
          title: product.title,
          error: errorMsg,
        });
        failed += 1;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Internal error";
      log.error("products/bulk-end", "Error ending product", error, { productId });

      failures.push({
        productId,
        title: "(unknown)",
        error: errorMsg,
      });
      failed += 1;
    }
  }

  log.info("products/bulk-end", "Bulk end completed", {
    total: productIds.length,
    ended,
    failed,
  });

  return NextResponse.json({
    total: productIds.length,
    ended,
    failed,
    failures,
  });
}
