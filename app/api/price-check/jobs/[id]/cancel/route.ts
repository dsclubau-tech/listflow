import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { cancelPriceCheckJob } from "@/lib/price-check-jobs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user?.id) {
    log.warn("price-check/jobs/[id]/cancel/POST", "Unauthorized cancel request", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await cancelPriceCheckJob(id, session.user.id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  log.info("price-check/jobs/[id]/cancel/POST", "Price check cancel requested", {
    jobId: job.id,
    status: job.status,
  });

  return NextResponse.json({ job });
}
