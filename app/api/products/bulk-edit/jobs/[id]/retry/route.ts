import { prepareInventoryJobRetry, type InventoryJobError } from "@/lib/ebay-inventory-job-results";
import { EbayActionJobStatus } from "@/app/generated/prisma/enums";
import { auth } from "@/auth";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { serializeEbayActionJob } from "@/lib/ebay-action-jobs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { assertWorkerSupportsDurableBulkEdit } from "@/lib/worker-heartbeat";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
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
    if(!["COMPLETED","FAILED","CANCELLED"].includes(job.status))return NextResponse.json({error:"This job is already running or retrying."},{status:409});
    const body=await request.json().catch(()=>({}));
    const selectedIds=Array.isArray(body.productIds)?body.productIds.filter((id:unknown)=>typeof id==="string") as string[]:undefined;
    const retry=prepareInventoryJobRetry({...job,errors:(Array.isArray(job.errors)?job.errors:[]) as unknown as InventoryJobError[]},job.bulkEditItems.map(item=>item.productId),selectedIds);
    const retryIds=retry.ids,completed=retry.completed,errors=retry.errors;
    if(!retryIds.length)return NextResponse.json({error:"No eligible failed items are available. Ended listings cannot be retried."},{status:409});

    const updated = await prisma.$transaction(async (tx) => {
      const claimed=await tx.ebayActionJob.updateMany({where:{id:job.id,status:job.status,updatedAt:job.updatedAt},data:{status:EbayActionJobStatus.QUEUED}});
      if(!claimed.count)throw new Error("This retry has already been queued.");
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
          failed: retry.failed,
          errors: JSON.parse(JSON.stringify(errors)),
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
