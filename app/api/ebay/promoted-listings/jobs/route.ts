import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  EbayActionJobType,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { invalidateJobCaches } from "@/lib/cache-tags";
import {
  createEbayActionJob,
  findPromotedCampaignDependency,
  getCurrentEbayActionJobs,
} from "@/lib/ebay-action-jobs";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  getPromotedListingJobQueueError,
  MAX_PROMOTED_LISTING_JOB_SIZE,
  normalizePromotedAdRate,
  normalizePromotedCampaignInput,
  normalizePromotedListingProductIds,
} from "@/lib/promoted-listings";
import {
  getCurrentStoreSession,
  getInternalUserId,
} from "@/lib/store-session";
import { assertWorkerOnlineForStore } from "@/lib/worker-heartbeat";

function getErrorStatus(error: unknown) {
  return error instanceof Error &&
    (error.name === "WorkerOfflineError" || error.name === "JobConflictError")
    ? 409
    : 400;
}

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

  const body = (await request.json().catch(() => ({}))) as {
    productIds?: unknown;
    operation?: unknown;
    bidPercentage?: unknown;
    campaign?: {
      mode?: unknown;
      campaignId?: unknown;
      campaignName?: unknown;
    };
    requestId?: unknown;
  };
  const productIds = normalizePromotedListingProductIds(body.productIds);
  const operation = body.operation === "REMOVE" ? "REMOVE" : "APPLY";

  if (productIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one eBay product." },
      { status: 400 },
    );
  }

  if (productIds.length > MAX_PROMOTED_LISTING_JOB_SIZE) {
    return NextResponse.json(
      { error: "Manage promotions for at most 2,000 products at a time." },
      { status: 400 },
    );
  }

  const rate =
    operation === "APPLY" ? normalizePromotedAdRate(body.bidPercentage) : null;
  const campaign =
    operation === "APPLY"
      ? normalizePromotedCampaignInput(body.campaign)
      : null;
  const requestId =
    typeof body.requestId === "string" && body.requestId.trim().length > 0
      ? body.requestId.trim().slice(0, 128)
      : undefined;

  if (body.requestId !== undefined && !requestId) {
    return NextResponse.json({ error: "A valid request ID is required." }, { status: 400 });
  }

  if (operation === "APPLY" && rate === null) {
    return NextResponse.json(
      { error: "Enter a fixed ad rate from 2.0% to 100.0% using one decimal place." },
      { status: 400 },
    );
  }

  if (
    operation === "APPLY" &&
    !campaign
  ) {
    return NextResponse.json(
      { error: "Choose an existing campaign or enter a campaign name up to 80 characters." },
      { status: 400 },
    );
  }

  const ownedProducts = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      storeId: storeSession.storeId,
      status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
      ebayItemId: { not: null },
    },
    select: { id: true },
  });

  if (ownedProducts.length !== productIds.length) {
    return NextResponse.json(
      { error: "Every selected product must be an imported listing from the current store." },
      { status: 422 },
    );
  }

  try {
    await assertWorkerOnlineForStore(storeSession.storeId);
    const userId = await getInternalUserId();
    const campaignDependencyJobId =
      operation === "APPLY" && campaign?.mode === "CREATE"
        ? await findPromotedCampaignDependency(
            storeSession.storeId,
            campaign.campaignName,
          )
        : null;
    const result = await createEbayActionJob({
      userId,
      storeId: storeSession.storeId,
      type: EbayActionJobType.MANAGE_PROMOTED_ADS,
      requestId,
      productIds,
      metadata: {
        kind: "promoted-ads",
        operation,
        bidPercentage: rate,
        campaignMode:
          operation === "APPLY"
            ? campaignDependencyJobId
              ? "DEPENDENT"
              : campaign?.mode ?? null
            : null,
        campaignId:
          operation === "APPLY" && campaign?.mode === "EXISTING"
            ? campaign.campaignId
            : null,
        campaignName:
          operation === "APPLY" && campaign?.mode === "CREATE"
            ? campaign.campaignName
            : null,
        campaignDependencyJobId,
      },
    });
    invalidateJobCaches(storeSession.storeId);
    let queuedJob:
      | Awaited<ReturnType<typeof getCurrentEbayActionJobs>>[number]
      | undefined;
    try {
      const queueJobs = await getCurrentEbayActionJobs(storeSession.storeId);
      queuedJob = queueJobs.find((job) => job.id === result.job.id);
    } catch (error) {
      log.warn(
        "ebay/promoted-listings/jobs",
        "Promotion job queued but queue position could not be read",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    return NextResponse.json(
      {
        ...result,
        job: queuedJob ?? result.job,
        message:
          operation === "REMOVE"
            ? `Queued ${result.job.total} listing(s) to remove from promotion.`
            : `Queued ${result.job.total} listing(s) for promotion.`,
      },
      { status: 202 },
    );
  } catch (error) {
    const queueError = getPromotedListingJobQueueError(error);
    const message =
      queueError?.message ??
      (error instanceof Error ? error.message : "Failed to queue promotion changes.");
    log.error(
      "ebay/promoted-listings/jobs",
      "Failed to queue promoted listing job",
      error,
    );
    return NextResponse.json(
      { error: message },
      { status: queueError?.status ?? getErrorStatus(error) },
    );
  }
}

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await getCurrentEbayActionJobs(storeSession.storeId);
  const activePromotions = jobs.filter(
    (job) =>
      job.type === EbayActionJobType.MANAGE_PROMOTED_ADS &&
      (job.status === "QUEUED" || job.status === "RUNNING"),
  );

  return NextResponse.json(
    {
      currentJob: activePromotions[0] ?? null,
      queuedCount: Math.max(0, activePromotions.length - 1),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
