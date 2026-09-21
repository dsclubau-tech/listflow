import { EbayActionJobStatus } from "@/app/generated/prisma/enums";
import { auth } from "@/auth";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { serializeEbayActionJob } from "@/lib/ebay-action-jobs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { assertWorkerSupportsDurableBulkEdit } from "@/lib/worker-heartbeat";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertWorkerSupportsDurableBulkEdit(storeSession.storeId);
    const job = await prisma.ebayActionJob.findFirst({
      where: { id, storeId: storeSession.storeId, type: "BULK_EDIT_REVISE" },
      include: { bulkEditItems: { where: { status: "FAILED" }, select: { productId: true } } },
    });
    if (!job || job.bulkEditItems.length === 0) {
      return NextResponse.json({ error: "No failed bulk-edit items are available to retry." }, { status: 409 });
    }
    const retryIds = job.bulkEditItems.map((item) => item.productId);
    const completed = job.completedProductIds.filter((productId) => !retryIds.includes(productId));
    const errors = Array.isArray(job.errors)
      ? job.errors.filter((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
          return !retryIds.includes(String((entry as Record<string, unknown>).productId ?? ""));
        })
      : [];

    const updated = await prisma.$transaction(async (tx) => {
      await tx.bulkEditJobItem.updateMany({
        where: { jobId: job.id, productId: { in: retryIds } },
        data: { status: "PENDING", attempts: 0, error: null, appliedAt: null, completedAt: null },
      });
      return tx.ebayActionJob.update({
        where: { id: job.id },
        data: {
          status: EbayActionJobStatus.QUEUED,
          completedProductIds: { set: completed },
          processed: completed.length,
          succeeded: job.succeeded,
          failed: 0,
          errors,
          errorMessage: null,
          completedAt: null,
        },
      });
    });
    invalidateJobCaches(storeSession.storeId);
    return NextResponse.json({ job: serializeEbayActionJob(updated) }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retry failed items." },
      { status: 409 },
    );
  }
}
