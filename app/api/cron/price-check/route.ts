import { NextResponse } from "next/server";
import { runPriceCheck } from "@/lib/price-checker";
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

  try {
    const result = await runPriceCheck();
    log.info("cron/price-check/route", "Cron price check completed", result);
    return NextResponse.json(result);
  } catch (error) {
    log.error("cron/price-check/route", "Cron price check failed", error);
    return NextResponse.json(
      { error: "Price check failed" },
      { status: 500 }
    );
  }
}
