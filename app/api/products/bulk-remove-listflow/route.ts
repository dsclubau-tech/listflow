import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidateProductCaches } from "@/lib/cache-tags";
import { deleteProductsFromListflow } from "@/lib/product-removal";

function normalizeRequestProductIds(productIds: unknown[]) {
  return Array.from(
    new Set(
      productIds
        .map((productId) =>
          typeof productId === "string" ? productId.trim() : ""
        )
        .filter((productId) => productId.length > 0)
    )
  );
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("products/bulk-remove-listflow", "Unauthorized remove attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    productIds?: unknown[];
  };
  const productIds = Array.isArray(body.productIds)
    ? normalizeRequestProductIds(body.productIds)
    : [];

  if (productIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one product to remove" },
      { status: 400 }
    );
  }

  try {
    const result = await deleteProductsFromListflow({
      storeId: storeSession.storeId,
      productIds,
    });

    if (result.deletedProducts === 0) {
      return NextResponse.json(
        { error: "No matching products were found to remove" },
        { status: 404 }
      );
    }

    log.warn("products/bulk-remove-listflow", "Products removed from ListFlow only", {
      requestedCount: result.requestedCount,
      deletedProducts: result.deletedProducts,
      deletedVariants: result.deletedVariants,
      deletedPriceHistory: result.deletedPriceHistory,
      deletedUploadLogs: result.deletedUploadLogs,
    });

    invalidateProductCaches(storeSession.storeId);

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedProducts,
    });
  } catch (error) {
    log.error("products/bulk-remove-listflow", "Failed to remove products", error, {
      requestedCount: productIds.length,
    });
    return NextResponse.json(
      { error: "Failed to remove products from ListFlow" },
      { status: 500 }
    );
  }
}
