import "server-only";

import { EbayActionJobStatus } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export async function cancelEbayActionJob(id: string, storeId: string) {
  // Compare-and-set prevents a concurrent worker claim from being cancelled as
  // though it were still queued, and never rewrites a completed job.
  await prisma.ebayActionJob.updateMany({
    where: { id, storeId, status: EbayActionJobStatus.QUEUED },
    data: { status: EbayActionJobStatus.CANCELLED, completedAt: new Date() },
  });
  await prisma.ebayActionJob.updateMany({
    where: { id, storeId, status: EbayActionJobStatus.RUNNING },
    data: { status: EbayActionJobStatus.CANCELLING },
  });
  return prisma.ebayActionJob.findFirst({ where: { id, storeId } });
}

export async function isEbayActionCancellationRequested(id: string) {
  const job = await prisma.ebayActionJob.findUnique({
    where: { id },
    select: { status: true },
  });
  return !job || job.status === EbayActionJobStatus.CANCELLING ||
    job.status === EbayActionJobStatus.CANCELLED;
}

// Only the worker holding the job's lease may acknowledge a running cancel.
// Keep the lane occupied until in-flight writes and their checkpoints finish.
export async function finishEbayActionCancellation(id: string) {
  return prisma.ebayActionJob.updateMany({
    where: { id, status: EbayActionJobStatus.CANCELLING },
    data: { status: EbayActionJobStatus.CANCELLED, completedAt: new Date() },
  });
}
