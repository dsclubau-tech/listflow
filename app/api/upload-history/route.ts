import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export async function DELETE() {
  const session = await auth();

  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized — admin access required" }, { status: 401 });
  }

  try {
    const result = await prisma.uploadLog.deleteMany({});
    logger.info("upload-history/DELETE", "Upload history cleared", {
      deleted: result.count,
      userId: session.user.id,
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (err) {
    logger.error("upload-history/DELETE", "Failed to clear history", err);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
