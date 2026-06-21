import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStoreCredentials, getStoreNumber } from "@/lib/ebay";
import {
  getEbayImportStats,
  removeStaleListFlowEbayProducts,
} from "@/lib/ebay-import";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function resolveStoreContext(
  storeId: string,
  log: ReturnType<typeof createRequestLogger>,
) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, isActive: true },
  });

  if (!store || !store.isActive) {
    return {
      error: NextResponse.json({ error: "Store not found" }, { status: 400 }),
    };
  }

  try {
    const storeNumber = await getStoreNumber(storeId);
    const credentials = getStoreCredentials(storeNumber);

    if (!credentials.refreshToken) {
      return {
        error: NextResponse.json(
          { error: `${store.name} has no eBay token configured` },
          { status: 400 },
        ),
      };
    }

    return { store, storeNumber };
  } catch (error) {
    log.error("ebay-import/stale", "Failed to resolve store context", error, {
      storeId,
    });
    return {
      error: NextResponse.json({ error: getErrorMessage(error) }, { status: 400 }),
    };
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
    log.warn("ebay-import/stale/POST", "Unauthorized stale cleanup attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await resolveStoreContext(storeSession.storeId, log);

  if ("error" in context) {
    return context.error;
  }

  try {
    const activeJobs = await prisma.ebayImportJob.count({
      where: {
        storeId: storeSession.storeId,
        status: { in: ["QUEUED", "RUNNING"] },
        dismissedAt: null,
      },
    });

    if (activeJobs > 0) {
      return NextResponse.json(
        { error: "Cannot remove stale products while an eBay import job is active" },
        { status: 409 },
      );
    }

    const result = await removeStaleListFlowEbayProducts({
      storeId: storeSession.storeId,
      storeNumber: context.storeNumber,
    });
    const stats = await getEbayImportStats({
      storeId: storeSession.storeId,
      storeNumber: context.storeNumber,
    });

    log.warn("ebay-import/stale/POST", "Removed stale ListFlow products", {
      deleted: result.deleted,
      activeListings: result.activeListings,
    });

    return NextResponse.json({
      ...result,
      stats: {
        storeId: storeSession.storeId,
        storeName: context.store.name,
        ...stats,
      },
    });
  } catch (error) {
    log.error("ebay-import/stale/POST", "Failed to remove stale products", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
