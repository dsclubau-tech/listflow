import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { invalidateJobCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { assertNoEbayLaneStartConflict } from "@/lib/job-coordination";
import { createRequestLogger } from "@/lib/logger";
import { applyBulkProductEdits } from "@/lib/product-bulk-edit";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";

function getErrorStatus(error: unknown) {
  if (error instanceof Error && error.name === "JobConflictError") {
    return 409;
  }

  return 400;
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("products/bulk-edit", "Unauthorized bulk edit attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    productIds?: unknown[];
    operations?: unknown;
    reviseEbay?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.reviseEbay !== true) {
    return NextResponse.json(
      { error: "Bulk edit must revise eBay listings." },
      { status: 400 }
    );
  }

  try {
    await assertNoEbayLaneStartConflict(storeSession.storeId, "write");

    const editResult = await applyBulkProductEdits({
      storeId: storeSession.storeId,
      productIds: body.productIds ?? [],
      operations: body.operations ?? [],
    });

    if (editResult.productIds.length === 0) {
      return NextResponse.json(
        {
          ...editResult,
          queued: false,
          job: null,
          error: "No selected products could be bulk edited.",
        },
        { status: 422 }
      );
    }

    const userId = await getInternalUserId();
    const jobResult = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.BULK_EDIT_REVISE,
      productIds: editResult.productIds,
    });

    invalidateProductCaches(storeSession.storeId);
    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(
      {
        ...editResult,
        ...jobResult,
        message: jobResult.queued
          ? `Queued ${jobResult.job.total} listing(s) for bulk eBay update.`
          : "Bulk edit saved locally.",
      },
      { status: jobResult.queued ? 202 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk edit failed.";
    log.error("products/bulk-edit", "Bulk edit failed", error);
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) });
  }
}
