import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { repairAlreadyListedDrafts } from "@/lib/drafts-page-data";
import { createRequestLogger } from "@/lib/logger";
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
    const repaired = await repairAlreadyListedDrafts(storeSession.storeId);
    return NextResponse.json({ repaired });
  } catch (error) {
    log.error("drafts/maintenance", "Draft repair failed", error);
    return NextResponse.json(
      { error: "Draft maintenance is temporarily unavailable." },
      { status: 500 },
    );
  }
}
