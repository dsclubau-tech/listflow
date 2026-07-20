import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import {
  createEbayActionJob,
  getCurrentEbayActionJobs,
} from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import {
  getLowStockProductWhere,
  isLowStockHoldJobMetadata,
  LOW_STOCK_HOLD_JOB_KIND,
  LOW_STOCK_THRESHOLD,
} from "@/lib/low-stock-products";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";
import { invalidateJobCaches } from "@/lib/cache-tags";

function getErrorStatus(error: unknown) {
  return error instanceof Error &&
    (error.name === "WorkerOfflineError" || error.name === "JobConflictError")
    ? 409
    : 400;
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("products/bulk-hold", "Unauthorized bulk hold attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    productIds?: unknown[];
    allLowStock?: unknown;
  };

  try {
    if (body.allLowStock === true) {
      const currentLowStockHoldJob = (await getCurrentEbayActionJobs(
        storeSession.storeId
      )).find(
        (job) =>
          job.type === EbayActionJobType.HOLD &&
          (job.status === "QUEUED" || job.status === "RUNNING") &&
          isLowStockHoldJobMetadata(job.metadata)
      );

      if (currentLowStockHoldJob) {
        return NextResponse.json({
          job: currentLowStockHoldJob,
          total: currentLowStockHoldJob.total,
          queued: false,
          reused: true,
          held: 0,
          failed: 0,
          failures: [],
          message: "A low-stock hold job is already queued or running.",
        });
      }
    }

    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const lowStockProducts =
      body.allLowStock === true
        ? await prisma.product.findMany({
            where: getLowStockProductWhere(storeSession.storeId),
            select: { id: true },
            orderBy: [{ amazonStockLeft: "asc" }, { title: "asc" }],
          })
        : null;
    const productIds = lowStockProducts
      ? lowStockProducts.map((product) => product.id)
      : body.productIds ?? [];
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.HOLD,
      productIds,
      metadata: lowStockProducts
        ? {
            kind: LOW_STOCK_HOLD_JOB_KIND,
            threshold: LOW_STOCK_THRESHOLD,
          }
        : undefined,
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(
      {
        ...result,
        total: result.job.total,
        held: 0,
        failed: 0,
        failures: [],
        message: result.queued
          ? `Queued ${result.job.total} listing(s) to put on hold.`
          : lowStockProducts
            ? "No low-stock products to put on hold."
            : "No products selected.",
      },
      { status: result.queued ? 202 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk hold failed.";
    log.error("products/bulk-hold", "Failed to queue bulk hold job", error);
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) });
  }
}
