import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

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
  };

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.HOLD,
      productIds: body.productIds ?? [],
    });

    return NextResponse.json(
      {
        ...result,
        total: result.job.total,
        held: 0,
        failed: 0,
        failures: [],
        message: result.queued
          ? `Queued ${result.job.total} listing(s) to put on hold.`
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
