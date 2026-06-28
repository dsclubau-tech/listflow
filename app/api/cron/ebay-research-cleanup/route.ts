import { NextResponse } from "next/server";
import { cleanupExpiredEbayResearchRecords } from "@/lib/ebay-research";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const log = createRequestLogger(request);
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret) {
    log.error(
      "cron/ebay-research-cleanup/route",
      "CRON_SECRET is not configured"
    );
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    log.warn(
      "cron/ebay-research-cleanup/route",
      "Unauthorized cron invocation"
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredEbayResearchRecords(undefined, {
      force: true,
    });
    log.info(
      "cron/ebay-research-cleanup/route",
      "Expired eBay research records removed",
      result
    );
    return NextResponse.json(result);
  } catch (error) {
    log.error(
      "cron/ebay-research-cleanup/route",
      "eBay research cleanup failed",
      error
    );
    return NextResponse.json(
      { error: "eBay research cleanup failed" },
      { status: 500 }
    );
  }
}
