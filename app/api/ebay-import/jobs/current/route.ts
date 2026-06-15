import { auth } from "@/auth";
import { getCurrentEbayImportJob } from "@/lib/ebay-import-jobs";
import { createRequestLogger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("ebay-import/jobs/current/GET", "Unauthorized current import job request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getCurrentEbayImportJob(storeSession.storeId);

  return NextResponse.json({ job });
}
