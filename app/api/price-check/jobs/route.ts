import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { createPriceCheckJob } from "@/lib/price-check-jobs";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";
import { invalidateJobCaches } from "@/lib/cache-tags";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user?.id || !storeSession) {
    log.warn("price-check/jobs/POST", "Unauthorized price check job attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productIds?: unknown[]; all?: boolean };
  try {
    body = (await request.json()) as { productIds?: unknown[]; all?: boolean };
  } catch (error) {
    log.error("price-check/jobs/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const result = await createPriceCheckJob({
      userId,
      storeId: storeSession.storeId,
      productIds: body.productIds,
      all: body.all === true,
    });

    log.info("price-check/jobs/POST", "Price check job request accepted", {
      jobId: result.job.id,
      status: result.job.status,
      total: result.job.total,
      reused: result.reused,
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start price check job";
    log.error("price-check/jobs/POST", "Failed to create price check job", error);
    return NextResponse.json(
      { error: message },
      {
        status:
          error instanceof Error &&
          (error.name === "WorkerOfflineError" || error.name === "JobConflictError")
            ? 409
            : 400,
      }
    );
  }
}
