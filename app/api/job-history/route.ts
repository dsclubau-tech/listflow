import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import {
  getUploadHistoryPagination,
  parseUploadHistoryPage,
  UPLOAD_HISTORY_PAGE_SIZE,
} from "@/lib/upload-history-pagination";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedPage = parseUploadHistoryPage(searchParams.get("page"));

  const totalCount = await prisma.ebayActionJob.count({
    where: { storeId: storeSession.storeId },
  });

  const pagination = getUploadHistoryPagination(totalCount, requestedPage);

  const jobs = await prisma.ebayActionJob.findMany({
    where: { storeId: storeSession.storeId },
    orderBy: { createdAt: "desc" },
    skip: pagination.skip,
    take: UPLOAD_HISTORY_PAGE_SIZE,
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      store: {
        select: { id: true, name: true },
      },
    },
  });

  return NextResponse.json({
    jobs,
    totalCount,
    page: pagination.page,
    totalPages: pagination.totalPages,
  });
}
