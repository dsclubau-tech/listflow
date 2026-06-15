import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getPriceCheckJobForStore } from "@/lib/price-check-jobs";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(
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
    log.warn("price-check/jobs/[id]/GET", "Unauthorized job request", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getPriceCheckJobForStore(id, storeSession.storeId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
