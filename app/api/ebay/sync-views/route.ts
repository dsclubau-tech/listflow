import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentStoreSession } from "@/lib/store-session";
import { syncEbaySoldCountsForStore } from "@/lib/ebay-sold-sync";
import { createRequestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const log = createRequestLogger(request);
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeSession = await getCurrentStoreSession();
  if (!storeSession) {
    return NextResponse.json(
      { error: "No store found or selected" },
      { status: 400 }
    );
  }

  try {
    const result = await syncEbaySoldCountsForStore(storeSession.storeId);
    log.info("ebay/sync-views/route", "Manual eBay views & sold sync completed", {
      storeId: storeSession.storeId,
      ...result,
    });

    return NextResponse.json({
      success: true,
      storeId: storeSession.storeId,
      ...result,
    });
  } catch (error) {
    log.error("ebay/sync-views/route", "Failed to sync eBay views & sold counts", error, {
      storeId: storeSession.storeId,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync eBay views",
      },
      { status: 500 }
    );
  }
}
