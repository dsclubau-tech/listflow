import { auth } from "@/auth";
import { cancelEbayImportJob } from "@/lib/ebay-import-jobs";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("ebay-import/jobs/[id]/cancel/POST", "Unauthorized import job cancel", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await cancelEbayImportJob(id, storeSession.storeId);

  if (!job) {
    return NextResponse.json(
      { error: "Import job cannot be cancelled." },
      { status: 400 },
    );
  }

  invalidateJobCaches(storeSession.storeId);

  return NextResponse.json({ job });
}
