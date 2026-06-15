import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentPriceCheckJob } from "@/lib/price-check-jobs";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user?.id || !storeSession) {
    log.warn("price-check/jobs/current/GET", "Unauthorized current job request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getCurrentPriceCheckJob(storeSession.storeId);

  return NextResponse.json({ job });
}
