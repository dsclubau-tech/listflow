import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { resumePriceCheckJob } from "@/lib/price-check-jobs";

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
    log.warn("price-check/jobs/[id]/resume/POST", "Unauthorized resume request", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resumePriceCheckJob(id, session.user.id);

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

    return NextResponse.json(result, {
      status: result.reused || !result.resumed ? 200 : 202,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume price check job";
    log.error("price-check/jobs/[id]/resume/POST", "Failed to resume job", error, {
      id,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
