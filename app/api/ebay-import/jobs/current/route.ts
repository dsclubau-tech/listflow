import { auth } from "@/auth";
import { getCurrentEbayImportJob } from "@/lib/ebay-import-jobs";
import { createRequestLogger } from "@/lib/logger";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("ebay-import/jobs/current/GET", "Unauthorized current import job request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId")?.trim() || undefined;
  const job = await getCurrentEbayImportJob(session.user.id, storeId);

  return NextResponse.json({ job });
}
