import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentEbayResearchBatches } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/batches/current/GET", "Unauthorized batch request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const batches = await getCurrentEbayResearchBatches(storeSession.storeId);

    return NextResponse.json({ batches });
  } catch (error) {
    log.error(
      "ebay-research/batches/current/GET",
      "Failed to load current research batches",
      error
    );
    return NextResponse.json(
      { batches: [], error: "Research batches are temporarily unavailable." },
      { status: 503 }
    );
  }
}
