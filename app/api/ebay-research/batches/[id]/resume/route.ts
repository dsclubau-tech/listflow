import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resumeEbayResearchBatch } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
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

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/batches/[id]/resume/POST", "Unauthorized resume attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const batch = await resumeEbayResearchBatch(id, storeSession.storeId);

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json({ batch });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume research batch";
    log.error(
      "ebay-research/batches/[id]/resume/POST",
      "Failed to resume research batch",
      error,
      { id }
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
