import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function DELETE(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("upload-history/DELETE", "Unauthorized upload-history clear attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await prisma.uploadLog.deleteMany({
      where: { storeId: storeSession.storeId },
    });
    log.info("upload-history/DELETE", "Upload history cleared", {
      deleted: result.count,
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    log.error("upload-history/DELETE", "Failed to clear history", error);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
