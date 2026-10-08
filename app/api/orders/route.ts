import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getOrdersPageData, normalizeOrdersPagination } from "@/lib/orders-data";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const session = await getCurrentStoreSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const { page, pageSize } = normalizeOrdersPagination(params.get("page"), params.get("pageSize"));
  try {
    const data = await getOrdersPageData(session.storeId, page, pageSize);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.error("orders/route", "Failed to read orders", error, { storeId: session.storeId });
    return NextResponse.json({ error: "Orders are temporarily unavailable." }, { status: 503 });
  }
}
