import { NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const log = createRequestLogger(request);
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret) {
    log.error("cron/price-check/route", "CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    log.warn("cron/price-check/route", "Unauthorized cron invocation");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = {
    skipped: true,
    reason:
      "Manual worker mode is enabled. Start price checks from ListFlow while the PC 1 worker shortcut is open.",
  };

  log.info("cron/price-check/route", "Cron price check skipped", response);
  return NextResponse.json(response);
}
