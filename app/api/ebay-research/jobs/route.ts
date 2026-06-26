import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createEbayResearchJob,
  getRecentEbayResearchJobs,
} from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/jobs/GET", "Unauthorized research jobs request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await getRecentEbayResearchJobs(storeSession.storeId);

  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/jobs/POST", "Unauthorized research job attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { query?: unknown; mode?: unknown; limit?: unknown };

  try {
    body = (await request.json()) as {
      query?: unknown;
      mode?: unknown;
      limit?: unknown;
    };
  } catch (error) {
    log.error("ebay-research/jobs/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const job = await createEbayResearchJob({
      userId,
      storeId: storeSession.storeId,
      query: body.query,
      mode: body.mode,
      limit: body.limit,
    });

    log.info("ebay-research/jobs/POST", "Research job accepted", {
      jobId: job.id,
      query: job.query,
      mode: job.mode,
      limit: job.limit,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start eBay research";
    log.error("ebay-research/jobs/POST", "Failed to create research job", error);
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
