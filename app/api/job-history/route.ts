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

  const [ebayCount, priceCheckCount] = await Promise.all([
    prisma.ebayActionJob.count({
      where: { storeId: storeSession.storeId },
    }),
    prisma.priceCheckJob.count({
      where: { storeId: storeSession.storeId },
    }),
  ]);
  const totalCount = ebayCount + priceCheckCount;

  const pagination = getUploadHistoryPagination(totalCount, requestedPage);

  const [ebayJobs, priceCheckJobs] = await Promise.all([
    prisma.ebayActionJob.findMany({
      where: { storeId: storeSession.storeId },
      orderBy: { createdAt: "desc" },
      take: pagination.skip + UPLOAD_HISTORY_PAGE_SIZE,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        store: {
          select: { id: true, name: true },
        },
      },
    }),
    prisma.priceCheckJob.findMany({
      where: { storeId: storeSession.storeId },
      orderBy: { createdAt: "desc" },
      take: pagination.skip + UPLOAD_HISTORY_PAGE_SIZE,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        store: {
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  const jobs = [
    ...ebayJobs.map((j) => ({ ...j, jobCategory: "EBAY_ACTION" })),
    ...priceCheckJobs.map((j) => ({
      ...j,
      jobCategory: "PRICE_CHECK",
      type: j.trigger === "AUTOMATIC" ? "AUTO_PRICE_CHECK" : "PRICE_CHECK",
      succeeded: j.checked,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(pagination.skip, pagination.skip + UPLOAD_HISTORY_PAGE_SIZE);

  return NextResponse.json({
    jobs,
    totalCount,
    page: pagination.page,
    totalPages: pagination.totalPages,
  });
}
