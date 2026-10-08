import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { parseOrderEdit } from "@/lib/orders";
import { logger } from "@/lib/logger";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentStoreSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let edit;
  try { edit = parseOrderEdit(await request.json()); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid order update" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const result = await prisma.ebayOrderLine.updateMany({
      where: { id, storeId: session.storeId }, data: edit,
    });
    if (result.count !== 1) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({ id, ...edit }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.error("orders/edit", "Failed to save order edit", error, { storeId: session.storeId });
    return NextResponse.json({ error: "Could not save the order. Please try again." }, { status: 503 });
  }
}
