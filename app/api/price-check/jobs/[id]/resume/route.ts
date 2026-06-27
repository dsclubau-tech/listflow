import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { resumePriceCheckJob } from "@/lib/price-check-jobs";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";
import { invalidateJobCaches } from "@/lib/cache-tags";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user?.id || !storeSession) {
    log.warn("price-check/jobs/[id]/resume/POST", "Unauthorized resume request", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const result = await resumePriceCheckJob(id, storeSession.storeId, userId);

    if (!result) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    log.info("price-check/jobs/[id]/resume/POST", "Price check resume requested", {
      sourceJobId: id,
      jobId: result.job.id,
      status: result.job.status,
      total: result.job.total,
      reused: result.reused,
      resumed: result.resumed,
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(result, {
      status: result.reused || !result.resumed ? 200 : 202,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume price check job";
    log.error("price-check/jobs/[id]/resume/POST", "Failed to resume job", error, {
      id,
    });
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
