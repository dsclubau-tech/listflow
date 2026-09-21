import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { invalidateJobCaches } from "@/lib/cache-tags";
import { createEbayActionJob } from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { prepareBulkProductEditJob } from "@/lib/product-bulk-edit";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerSupportsDurableBulkEdit } from "@/lib/worker-heartbeat";

function getErrorStatus(error: unknown) {
  if (
    error instanceof Error &&
    (error.name === "JobConflictError" || error.name === "WorkerOfflineError")
  ) {
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
    requestId?: unknown;
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

  if (
    typeof body.requestId !== "string" ||
    body.requestId.trim().length < 8 ||
    body.requestId.length > 100
  ) {
    return NextResponse.json({ error: "A valid bulk-edit request ID is required." }, { status: 400 });
  }

  try {
    await assertWorkerSupportsDurableBulkEdit(storeSession.storeId);

    const editResult = await prepareBulkProductEditJob({
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
      metadata: {
        kind: "bulk-edit",
        fields: editResult.operationFields,
        durable: true,
      },
      requestId: body.requestId.trim(),
      itemPayload: { operations: editResult.operations },
    });

    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(
      {
        ...editResult,
        ...jobResult,
        message: jobResult.queued
          ? `Queued ${jobResult.job.total} listing(s) for bulk eBay update.`
          : "Bulk edit completed without queued listings.",
      },
      { status: jobResult.queued ? 202 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk edit failed.";
    log.error("products/bulk-edit", "Bulk edit failed", error);
    return NextResponse.json({ error: message }, { status: getErrorStatus(error) });
  }
}
