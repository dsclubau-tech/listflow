import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";

export async function DELETE(request: Request) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    log.warn("upload-history/DELETE", "Unauthorized upload-history clear attempt");
    return NextResponse.json({ error: "Unauthorized - admin access required" }, { status: 401 });
  }

  try {
    const result = await prisma.uploadLog.deleteMany({});
    log.info("upload-history/DELETE", "Upload history cleared", {
      deleted: result.count,
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    log.error("upload-history/DELETE", "Failed to clear history", error);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
