import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType, ProductStatus } from "@/app/generated/prisma/enums";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { canonicalizePackageItemSpecifics, getStoredPackageDimensions } from "@/lib/package-data-sync";
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
    log.warn("products/package-data/apply", "Unauthorized package apply request");
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
        status: ProductStatus.IMPORTED,
        ebayItemId: { not: null },
        ...(body.all === true ? {} : { id: { in: requestedIds } }),
      },
      select: { id: true, itemSpecifics: true },
    });
    const eligibleProducts = products.filter((product) =>
      Boolean(getStoredPackageDimensions(canonicalizePackageItemSpecifics(product.itemSpecifics))),
    );
    const userId = await getInternalUserId();
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.APPLY_PACKAGE_DATA,
      productIds: eligibleProducts.map((product) => product.id),
      metadata: { kind: "package-data-apply", mode: body.all === true ? "all" : "selected" },
    });

    invalidateJobCaches(storeSession.storeId);
    return NextResponse.json(
      {
        ...result,
        total: result.job.total,
        skipped: products.length - eligibleProducts.length,
        message: result.queued
          ? `Queued ${result.job.total} eBay listing(s) for package-data update.`
          : "No imported listings have complete package data to apply.",
      },
      { status: result.queued ? 202 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue package-data update.";
    log.error("products/package-data/apply", "Failed to queue package-data update", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
