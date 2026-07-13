import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { dismissObsoletePendingPriceChanges } from "@/lib/price-history-cleanup";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dismissed = await dismissObsoletePendingPriceChanges(
      storeSession.storeId,
    );
    return NextResponse.json({ dismissed });
  } catch (error) {
    log.error(
      "price-tracker/maintenance",
      "Pending price cleanup failed",
      error,
    );
    return NextResponse.json(
      { error: "Price tracker maintenance is temporarily unavailable." },
      { status: 500 },
    );
  }
}
