import { NextResponse } from "next/server";
import { syncEbaySoldCountsForAllStores } from "@/lib/ebay-sold-sync";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const log = createRequestLogger(request);
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret) {
    log.error("cron/sync-ebay-views/route", "CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    log.warn("cron/sync-ebay-views/route", "Unauthorized cron invocation");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncEbaySoldCountsForAllStores();
    log.info("cron/sync-ebay-views/route", "Completed 24-hour eBay sold & views sync", result);
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("cron/sync-ebay-views/route", "24-hour eBay sold & views sync failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "eBay sold & views sync failed",
      },
      { status: 500 }
    );
  }
}
