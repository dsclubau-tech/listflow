import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType, ProductStatus } from "@/app/generated/prisma/enums";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

function normalizeProductIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("products/package-data/sync", "Unauthorized package sync request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    all?: unknown;
    productIds?: unknown;
  };

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const requestedIds = normalizeProductIds(body.productIds);
    const products = await prisma.product.findMany({
      where: {
        storeId: storeSession.storeId,
        status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
        ebayItemId: { not: null },
        ...(body.all === true ? {} : { id: { in: requestedIds } }),
      },
      select: { id: true },
    });
    const userId = await getInternalUserId();
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.SYNC_PACKAGE_DATA,
      productIds: products.map((product) => product.id),
      metadata: { kind: "package-data-sync", mode: body.all === true ? "all" : "selected" },
    });

    invalidateJobCaches(storeSession.storeId);
    return NextResponse.json(
      {
        ...result,
        total: result.job.total,
        message: result.queued
          ? `Queued ${result.job.total} eBay listing(s) to sync package data into ListFlow.`
          : "No listed products were eligible for package-data sync.",
      },
      { status: result.queued ? 202 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue package-data sync.";
    log.error("products/package-data/sync", "Failed to queue package-data sync", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
