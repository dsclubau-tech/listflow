import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { serializeEbayActionJob } from "@/lib/ebay-action-jobs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getEbayActionQueuePositions } from "@/lib/ebay-action-queue";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.ebayActionJob.findFirst({
    where: {
      id,
      storeId: storeSession.storeId,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const activeJobs = await prisma.ebayActionJob.findMany({
    where: {
      storeId: storeSession.storeId,
      status: { in: ["QUEUED", "RUNNING", "CANCELLING"] },
      dismissedAt: null,
    },
    select: { id: true, status: true, createdAt: true },
  });
  const queuePosition = getEbayActionQueuePositions(activeJobs).get(job.id) ?? null;

  return NextResponse.json({
    job: { ...serializeEbayActionJob(job), queuePosition },
  });
}
