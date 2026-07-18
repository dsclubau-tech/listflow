import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { NextResponse } from "next/server";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { prisma } from "@/lib/prisma";
import { uploadProductToEbay } from "@/lib/ebay-upload";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

function getErrorStatus(error: unknown) {
  return error instanceof Error &&
    (error.name === "WorkerOfflineError" || error.name === "JobConflictError")
    ? 409
    : 500;
}

function normalizeProductIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("upload/route", "Unauthorized upload attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("upload/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const directProductId =
    typeof body.productId === "string" ? body.productId.trim() : "";
  const productIds = normalizeProductIds(body.productIds);
  const requestedProductIds =
    productIds.length > 0
      ? productIds
      : directProductId
        ? [directProductId]
        : [];
  const background = body.background === true || body.queue === true;

  if (requestedProductIds.length === 0) {
    log.warn("upload/route", "Upload request missing productId");
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 },
    );
  }

  if (!background && requestedProductIds.length !== 1) {
    return NextResponse.json(
      { error: "Direct upload requires exactly one productId." },
      { status: 400 },
    );
  }

  log.info("upload/route", "Upload request received", {
    productIds: requestedProductIds,
    background,
  });

  try {
    const existingProducts = await prisma.product.findMany({
      where: {
        id: { in: requestedProductIds },
        storeId: storeSession.storeId,
      },
      select: { id: true },
    });
    const existingProductIdSet = new Set(
      existingProducts.map((product) => product.id),
    );
    const uploadProductIds = requestedProductIds.filter((productId) =>
      existingProductIdSet.has(productId),
    );

    if (uploadProductIds.length === 0) {
      log.warn("upload/route", "Product not found for upload", {
        productIds: requestedProductIds,
      });
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const userId = await getInternalUserId();

    if (background) {
      await assertWorkerOnlineForStore(storeSession.storeId);
      const result = await createEbayActionJob({
        userId,
        storeId: storeSession.storeId,
        type: EbayActionJobType.UPLOAD_LISTING,
        productIds: uploadProductIds,
      });

      invalidateJobCaches(storeSession.storeId);

      return NextResponse.json(
        {
          success: result.queued,
          ...result,
          total: result.job.total,
          message: result.queued
            ? `Queued ${result.job.total} listing(s) to upload.`
            : "No products selected.",
        },
        { status: result.queued ? 202 : 200 },
      );
    }

    const result = await uploadProductToEbay({
      productId: uploadProductIds[0],
      storeId: storeSession.storeId,
      userId,
      log,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";

    log.error("upload/route", "Failed to start upload", error, {
      productIds: requestedProductIds,
      background,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: getErrorStatus(error) },
    );
  }
}
