import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLiveActionCenterData } from "@/lib/action-center";
import { logger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const live = await getLiveActionCenterData(storeSession.storeId);
    return NextResponse.json(live, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    logger.error(
      "action-center/live",
      "Failed to refresh live Action Center status",
      error,
      { storeId: storeSession.storeId },
    );
    return NextResponse.json(
      { error: "Live job status is temporarily unavailable." },
      { status: 503 },
    );
  }
}
