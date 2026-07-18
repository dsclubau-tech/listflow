import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

function getErrorStatus(error: unknown) {
  return error instanceof Error &&
    (error.name === "WorkerOfflineError" || error.name === "JobConflictError")
    ? 409
    : 500;
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("revise/route", "Unauthorized revise attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("revise/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { productId } = body;

  if (!productId) {
    log.warn("revise/route", "Revise request missing productId");
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
    include: { store: true },
  });

  if (!product) {
    log.warn("revise/route", "Product not found for revise", { productId });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "IMPORTED" || !product.ebayItemId) {
    log.warn("revise/route", "Rejected revise for product not listed on eBay", {
      productId,
    });
    return NextResponse.json(
      { error: "Product is not currently listed on eBay" },
      { status: 400 },
    );
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.REVISE_LISTING,
      productIds: [product.id],
      metadata: { kind: "revise-listing", includePictures: true },
    });

    invalidateJobCaches(storeSession.storeId);
    log.info("revise/route", "Queued eBay listing revision", {
      productId,
      ebayItemId: product.ebayItemId,
      jobId: result.job.id,
    });

    return NextResponse.json(
      {
        success: result.queued,
        ...result,
        total: result.job.total,
        message: result.queued
          ? "eBay update queued. Track it in Action Center."
          : "No product selected.",
      },
      { status: result.queued ? 202 : 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to queue eBay update.";
    log.error("revise/route", "Failed to queue eBay listing revision", error, {
      productId,
    });
    return NextResponse.json(
      { success: false, error: message },
      { status: getErrorStatus(error) },
    );
  }
}
