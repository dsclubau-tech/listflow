import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEbayResearchJobForStore } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
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

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/jobs/[id]/GET", "Unauthorized research job request", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const job = await getEbayResearchJobForStore(id, storeSession.storeId);

    if (!job) {
      return NextResponse.json({ error: "Research job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    log.error(
      "ebay-research/jobs/[id]/GET",
      "Failed to load research job",
      error,
      { id }
    );
    return NextResponse.json(
      { error: "Research job is temporarily unavailable." },
      { status: 503 }
    );
  }
}
