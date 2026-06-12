import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentPriceCheckJob } from "@/lib/price-check-jobs";

export async function GET(request: Request) {
  const session = await auth();
  const log = createRequestLogger(
    request,
    session?.user ? { userId: session.user.id } : {}
  );

  if (!session?.user?.id) {
    log.warn("price-check/jobs/current/GET", "Unauthorized current job request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getCurrentPriceCheckJob(session.user.id);

  return NextResponse.json({ job });
}
