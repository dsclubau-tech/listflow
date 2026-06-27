import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pauseEbayResearchBatch } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidateJobCaches } from "@/lib/cache-tags";

export async function POST(
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

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/batches/[id]/pause/POST", "Unauthorized pause attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batch = await pauseEbayResearchBatch(id, storeSession.storeId);

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  invalidateJobCaches(storeSession.storeId);

  return NextResponse.json({ batch });
}
