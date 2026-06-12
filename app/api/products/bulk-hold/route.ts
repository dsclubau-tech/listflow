import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildReviseQuantityXML } from "@/lib/ebay-xml";
import { callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { ProductStatus } from "@/app/generated/prisma/enums";

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
    log.warn("products/bulk-hold", "Unauthorized bulk hold attempt");
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
      held: 0,
      failed: 0,
      failures: [],
    });
  }

  let held = 0;
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

      if (product.status !== ProductStatus.IMPORTED || !product.ebayItemId) {
        failures.push({
          productId: product.id,
          title: product.title,
          error: "Product is not imported or lacks an eBay Item ID",
        });
        failed += 1;
        continue;
      }

      const storeNumber = await getStoreNumber(product.storeId);
      const xml = buildReviseQuantityXML(product.ebayItemId, 0);

      log.info("products/bulk-hold", "Putting listing on hold on eBay", {
        productId,
        ebayItemId: product.ebayItemId,
      });

      const result = await callEbayReviseItem(xml, storeNumber);

      if (result.success) {
        log.info("products/bulk-hold", "eBay ReviseItem succeeded, updating product status to ON_HOLD", {
          productId,
          ebayItemId: product.ebayItemId,
        });

        // Set status to ON_HOLD and clear priceCheckError
        await prisma.product.update({
          where: { id: product.id },
          data: {
            status: ProductStatus.ON_HOLD,
            priceCheckError: null,
          },
        });

        held += 1;
      } else {
        const errorMsg = result.errorMessage || "Unknown eBay API error";
        log.error("products/bulk-hold", "eBay ReviseItem failed", undefined, {
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
      log.error("products/bulk-hold", "Error holding product", error, { productId });

      failures.push({
        productId,
        title: "(unknown)",
        error: errorMsg,
      });
      failed += 1;
    }
  }

  log.info("products/bulk-hold", "Bulk hold completed", {
    total: productIds.length,
    held,
    failed,
  });

  return NextResponse.json({
    total: productIds.length,
    held,
    failed,
    failures,
  });
}
