import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { fetchRailwayUsageReport } from "@/lib/railway-api";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("railway/usage/GET", "Unauthorized railway usage request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await fetchRailwayUsageReport();
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("railway/usage/GET", "Failed to fetch Railway usage report", error);
    return NextResponse.json(
      { error: errorMsg || "Failed to fetch Railway usage report" },
      { status: 500 }
    );
  }
}
