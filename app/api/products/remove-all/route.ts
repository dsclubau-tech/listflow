import { auth } from "@/auth";
import {
  EbayImportJobStatus,
  PriceCheckJobStatus,
  ProductStatus,
} from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";
import { invalidateAllStoreCaches } from "@/lib/cache-tags";

const ACTIVE_PRICE_CHECK_STATUSES = [
  PriceCheckJobStatus.QUEUED,
  PriceCheckJobStatus.RUNNING,
  PriceCheckJobStatus.CANCELLING,
];

const ACTIVE_EBAY_IMPORT_STATUSES = [
  EbayImportJobStatus.QUEUED,
  EbayImportJobStatus.RUNNING,
  EbayImportJobStatus.PAUSING,
  EbayImportJobStatus.PAUSED,
  EbayImportJobStatus.CANCELLING,
];

type ProductCounts = Record<ProductStatus, number>;

type RemovalSnapshotLogger = ReturnType<typeof createRequestLogger>;

function emptyProductCounts(): ProductCounts {
  return {
    [ProductStatus.DRAFT]: 0,
    [ProductStatus.FAILED]: 0,
    [ProductStatus.IMPORTED]: 0,
    [ProductStatus.ON_HOLD]: 0,
  };
}

async function countActiveJobsSafely(
  label: "price check" | "eBay import",
  count: () => Promise<number>,
  log: RemovalSnapshotLogger,
) {
  try {
    return {
      count: await count(),
      verified: true,
    };
  } catch (error) {
    log.error("products/remove-all/snapshot", `Failed to count active ${label} jobs`, error);
    return {
      count: 0,
      verified: false,
    };
  }
}

async function getRemovalSnapshot(storeId: string, log: RemovalSnapshotLogger) {
  const [statusGroups, total] = await Promise.all([
    prisma.product.groupBy({
      by: ["status"],
      where: { storeId },
      _count: { _all: true },
    }),
    prisma.product.count({ where: { storeId } }),
  ]);

  const [activePriceCheckJobs, activeEbayImportJobs] = await Promise.all([
    countActiveJobsSafely(
      "price check",
      () =>
        prisma.priceCheckJob.count({
          where: {
            storeId,
            status: { in: ACTIVE_PRICE_CHECK_STATUSES },
            dismissedAt: null,
          },
        }),
      log,
    ),
    countActiveJobsSafely(
      "eBay import",
      () =>
        prisma.ebayImportJob.count({
          where: {
            storeId,
            status: { in: ACTIVE_EBAY_IMPORT_STATUSES },
            dismissedAt: null,
          },
        }),
      log,
    ),
  ]);

  const activeJobsVerified =
    activePriceCheckJobs.verified && activeEbayImportJobs.verified;
  const activeJobCount =
    activePriceCheckJobs.count + activeEbayImportJobs.count;

  const counts = emptyProductCounts();
  for (const group of statusGroups) {
    counts[group.status] = group._count._all;
  }

  return {
    total,
    counts,
    activeJobs: {
      priceCheck: activePriceCheckJobs.count,
      ebayImport: activeEbayImportJobs.count,
    },
    activeJobsVerified,
    activeJobsWarning: activeJobsVerified
      ? null
      : "ListFlow could not verify active background jobs, so removal is disabled for safety.",
    isBlocked: !activeJobsVerified || activeJobCount > 0,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("products/remove-all/GET", "Unauthorized removal snapshot request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getRemovalSnapshot(storeSession.storeId, log);

    return NextResponse.json({
      storeName: storeSession.storeName,
      storeLoginId: storeSession.storeLoginId,
      confirmationPhrase: `REMOVE ${storeSession.storeLoginId}`,
      ...snapshot,
    });
  } catch (error) {
    log.error("products/remove-all/GET", "Removal snapshot failed", error);
    return NextResponse.json(
      { error: "Failed to load removal summary" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("products/remove-all/POST", "Unauthorized removal attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("products/remove-all/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const confirmationPhrase = `REMOVE ${storeSession.storeLoginId}`;
  if (body?.confirmationPhrase !== confirmationPhrase) {
    log.warn("products/remove-all/POST", "Incorrect confirmation phrase");
    return NextResponse.json(
      { error: "Confirmation phrase does not match" },
      { status: 400 },
    );
  }

  let snapshot;
  try {
    snapshot = await getRemovalSnapshot(storeSession.storeId, log);
  } catch (error) {
    log.error("products/remove-all/POST", "Removal snapshot failed", error);
    return NextResponse.json(
      { error: "Failed to load removal summary" },
      { status: 500 },
    );
  }

  if (snapshot.isBlocked) {
    return NextResponse.json(
      {
        error:
          snapshot.activeJobsVerified
            ? "Cannot remove listings while a price check or eBay import job is active"
            : "Cannot remove listings because ListFlow could not verify active background jobs",
        ...snapshot,
      },
      { status: 409 },
    );
  }

  try {
    const [
      uploadLogs,
      priceHistory,
      variants,
      ebayImportStatsCache,
      products,
    ] = await prisma.$transaction([
      prisma.uploadLog.deleteMany({ where: { storeId: storeSession.storeId } }),
      prisma.priceHistory.deleteMany({
        where: { product: { is: { storeId: storeSession.storeId } } },
      }),
      prisma.variant.deleteMany({
        where: { product: { is: { storeId: storeSession.storeId } } },
      }),
      prisma.ebayImportStatsCache.deleteMany({
        where: { storeId: storeSession.storeId },
      }),
      prisma.product.deleteMany({ where: { storeId: storeSession.storeId } }),
    ]);

    log.warn("products/remove-all/POST", "All store products removed from ListFlow", {
      deletedProducts: products.count,
      deletedVariants: variants.count,
      deletedPriceHistory: priceHistory.count,
      deletedUploadLogs: uploadLogs.count,
      deletedEbayImportStatsCache: ebayImportStatsCache.count,
    });

    invalidateAllStoreCaches(storeSession.storeId);

    return NextResponse.json({
      success: true,
      deletedProducts: products.count,
      deletedVariants: variants.count,
      deletedPriceHistory: priceHistory.count,
      deletedUploadLogs: uploadLogs.count,
      deletedEbayImportStatsCache: ebayImportStatsCache.count,
    });
  } catch (error) {
    log.error("products/remove-all/POST", "Removal failed", error);
    return NextResponse.json(
      { error: "Failed to remove listings from ListFlow" },
      { status: 500 },
    );
  }
}
