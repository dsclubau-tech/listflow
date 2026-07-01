import { auth } from "@/auth";
import { resumeEbayImportJob } from "@/lib/ebay-import-jobs";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";
import { NextResponse } from "next/server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("ebay-import/jobs/[id]/resume/POST", "Unauthorized import job resume", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const job = await resumeEbayImportJob(id, storeSession.storeId);

    if (!job) {
      return NextResponse.json(
        { error: "Import job cannot be resumed." },
        { status: 400 },
      );
    }

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json({ job });
  } catch (error) {
    log.error("ebay-import/jobs/[id]/resume/POST", "Failed to resume import job", error, {
      id,
    });
    return NextResponse.json(
      { error: getErrorMessage(error) },
      {
        status:
          error instanceof Error && error.name === "WorkerOfflineError" ? 409 : 400,
      },
    );
  }
}
