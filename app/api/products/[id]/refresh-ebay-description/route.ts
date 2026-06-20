import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStoreNumber } from "@/lib/ebay";
import { refreshProductDescriptionFromEbay } from "@/lib/ebay-import";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("api/products/refresh-ebay-description", "Unauthorized attempt", {
      id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const storeNumber = await getStoreNumber(storeSession.storeId);
    const description = await refreshProductDescriptionFromEbay(
      storeSession.storeId,
      storeNumber,
      id,
    );

    return NextResponse.json({ description });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh description";
    log.error(
      "api/products/refresh-ebay-description",
      "Failed to refresh eBay description",
      error,
      { id },
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
