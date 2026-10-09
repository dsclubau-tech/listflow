import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { orderGroupKey, parseOrderNoteEdit } from "@/lib/order-notes";
import { logger } from "@/lib/logger";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentStoreSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let edit;
  try { edit = parseOrderNoteEdit(await request.json()); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid order note" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const line = await prisma.ebayOrderLine.findFirst({
      where: { id, storeId: session.storeId },
      select: { storeId: true, accountKey: true, ebayOrderId: true },
    });
    if (!line) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const note = await prisma.ebayOrderNote.upsert({
      where: { storeId_accountKey_ebayOrderId: line },
      create: { ...line, ...edit }, update: edit,
      select: { internalNote: true },
    });
    return NextResponse.json({ ...note, orderGroupKey: orderGroupKey(line) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    // Note contents are private and must not appear in logs.
    logger.warn("orders/note", "Failed to save order note", { storeId: session.storeId });
    return NextResponse.json({ error: "Could not save the order note. Please try again." }, { status: 503 });
  }
}
