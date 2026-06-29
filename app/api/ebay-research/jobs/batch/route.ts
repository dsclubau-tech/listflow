import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createEbayResearchBatch } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
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

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/jobs/batch/POST", "Unauthorized batch attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    queries?: unknown;
    limit?: unknown;
    conditionFilter?: unknown;
  };

  try {
    body = (await request.json()) as {
      queries?: unknown;
      limit?: unknown;
      conditionFilter?: unknown;
    };
  } catch (error) {
    log.error("ebay-research/jobs/batch/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const batch = await createEbayResearchBatch({
      userId,
      storeId: storeSession.storeId,
      queries: body.queries,
      limit: body.limit,
      conditionFilter: body.conditionFilter,
    });

    log.info("ebay-research/jobs/batch/POST", "Research batch accepted", {
      batchId: batch.id,
      total: batch.total,
      conditionFilter: batch.jobs[0]?.conditionFilter,
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json({ batch, jobs: batch.jobs }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start eBay research batch";
    log.error(
      "ebay-research/jobs/batch/POST",
      "Failed to create research batch",
      error
    );
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
