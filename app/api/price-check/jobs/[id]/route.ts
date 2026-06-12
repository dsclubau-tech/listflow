import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getPriceCheckJobForUser } from "@/lib/price-check-jobs";

export async function GET(
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
    log.warn("price-check/jobs/[id]/GET", "Unauthorized job request", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getPriceCheckJobForUser(id, session.user.id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
