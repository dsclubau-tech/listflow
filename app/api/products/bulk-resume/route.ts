import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
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
    log.warn("products/bulk-resume", "Unauthorized bulk resume attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    productIds?: unknown[];
  };

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.RESUME,
      productIds: body.productIds ?? [],
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(
      {
        ...result,
        total: result.job.total,
        resumed: 0,
        failed: 0,
        failures: [],
        message: result.queued
          ? `Queued ${result.job.total} listing(s) to resume.`
          : "No products selected.",
      },
      { status: result.queued ? 202 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk resume failed.";
    log.error("products/bulk-resume", "Failed to queue bulk resume job", error);
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) });
  }
}
