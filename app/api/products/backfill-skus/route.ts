import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { invalidateJobCaches, invalidateProductCaches } from "@/lib/cache-tags";
import { createRequestLogger } from "@/lib/logger";
import { backfillMissingListingSkus } from "@/lib/sku-backfill";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const result = await backfillMissingListingSkus({
      storeId: storeSession.storeId,
      userId: await getInternalUserId(),
    });

    invalidateProductCaches(storeSession.storeId);
    invalidateJobCaches(storeSession.storeId);

    return NextResponse.json(
      {
        ...result,
        message:
          result.updated > 0
            ? `Filled and queued ${result.updated} missing SKU(s) for eBay.`
            : "Every listed product already has a SKU.",
      },
      { status: result.queued ? 202 : 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "SKU backfill failed.";
    log.error("products/backfill-skus", "SKU backfill failed", error);

    return NextResponse.json(
      { error: message },
      {
        status:
          error instanceof Error && error.name === "WorkerOfflineError"
            ? 409
            : 500,
      },
    );
  }
}
