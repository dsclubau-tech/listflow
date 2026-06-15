import { NextResponse } from "next/server";
import { runPriceCheck } from "@/lib/price-checker";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

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
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const byStore = [];
    const total = {
      checked: 0,
      changed: 0,
      pendingReview: 0,
      failed: 0,
      skipped: 0,
    };

    for (const store of stores) {
      const result = await runPriceCheck({ storeId: store.id });
      byStore.push({ storeId: store.id, storeName: store.name, ...result });
      total.checked += result.checked;
      total.changed += result.changed;
      total.pendingReview += result.pendingReview;
      total.failed += result.failed;
      total.skipped += result.skipped;
    }

    const response = { ...total, byStore };
    log.info("cron/price-check/route", "Cron price check completed", response);
    return NextResponse.json(response);
  } catch (error) {
    log.error("cron/price-check/route", "Cron price check failed", error);
    return NextResponse.json(
      { error: "Price check failed" },
      { status: 500 }
    );
  }
}
