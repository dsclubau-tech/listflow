import { auth } from "@/auth";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

const DELETABLE_STATUSES = [ProductStatus.DRAFT, ProductStatus.FAILED];

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("api/products/bulk-delete/POST", "Unauthorized delete attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("api/products/bulk-delete/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.productIds)) {
    return NextResponse.json(
      { error: "productIds must be an array" },
      { status: 400 },
    );
  }

  const rawProductIds: unknown[] = body.productIds;
  const productIds: string[] = Array.from(
    new Set(
      rawProductIds
        .map((productId: unknown) =>
          typeof productId === "string" ? productId.trim() : "",
        )
        .filter((productId: string) => productId.length > 0),
    ),
  );

  if (productIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one product to delete" },
      { status: 400 },
    );
  }

  const productWhere = {
    id: { in: productIds },
    storeId: storeSession.storeId,
    status: { in: DELETABLE_STATUSES },
  };

  try {
    const [, , deletedProducts] = await prisma.$transaction([
      prisma.uploadLog.deleteMany({
        where: { product: { is: productWhere } },
      }),
      prisma.variant.deleteMany({
        where: { product: { is: productWhere } },
      }),
      prisma.product.deleteMany({
        where: productWhere,
      }),
    ]);

    if (deletedProducts.count === 0) {
      return NextResponse.json(
        { error: "No draft or failed products were found to delete" },
        { status: 400 },
      );
    }

    log.info("api/products/bulk-delete/POST", "Products deleted", {
      requestedCount: productIds.length,
      deletedCount: deletedProducts.count,
    });

    return NextResponse.json({
      success: true,
      deletedCount: deletedProducts.count,
    });
  } catch (error) {
    log.error("api/products/bulk-delete/POST", "Bulk delete failed", error, {
      requestedCount: productIds.length,
    });
    return NextResponse.json(
      { error: "Failed to delete selected products" },
      { status: 500 },
    );
  }
}
