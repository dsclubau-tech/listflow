import { auth } from "@/auth";
import { dismissEbayImportJob } from "@/lib/ebay-import-jobs";
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
    log.warn("ebay-import/jobs/[id]/dismiss/POST", "Unauthorized import job dismiss", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await dismissEbayImportJob(id, storeSession.storeId);

  if (!job) {
    return NextResponse.json(
      { error: "Only completed or failed import jobs can be dismissed" },
      { status: 404 },
    );
  }

  return NextResponse.json({ job });
}
