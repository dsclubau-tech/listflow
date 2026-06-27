import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { dismissPriceCheckJob } from "@/lib/price-check-jobs";
import { getCurrentStoreSession } from "@/lib/store-session";
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
    log.warn("price-check/jobs/[id]/dismiss/POST", "Unauthorized dismiss request", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await dismissPriceCheckJob(id, storeSession.storeId);

  if (!job) {
    return NextResponse.json(
      { error: "Only completed, failed, or cancelled jobs can be dismissed" },
      { status: 404 }
    );
  }

  log.info("price-check/jobs/[id]/dismiss/POST", "Price check job dismissed", {
    jobId: job.id,
    status: job.status,
  });

  invalidateJobCaches(storeSession.storeId);

  return NextResponse.json({ job });
}
