import { auth } from "@/auth";
import { getStoreCredentials, getStoreNumber } from "@/lib/ebay";
import { getEbayImportStats } from "@/lib/ebay-import";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

export const maxDuration = 300;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function resolveImportStore(
  storeId: string,
  log: ReturnType<typeof createRequestLogger>,
) {
  if (!storeId) {
    log.warn("ebay-import/route", "Import request missing storeId");
    return {
      error: NextResponse.json({ error: "storeId is required" }, { status: 400 }),
    };
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, isActive: true },
  });

  if (!store || !store.isActive) {
    log.warn("ebay-import/route", "Invalid store supplied for import", {
      storeId,
    });
    return {
      error: NextResponse.json({ error: "Store not found" }, { status: 400 }),
    };
  }

  let storeNumber: 1 | 2 | 3;

  try {
    storeNumber = await getStoreNumber(storeId);
  } catch (error) {
    log.error("ebay-import/route", "Failed to resolve store number", error, {
      storeId,
    });
    return {
      error: NextResponse.json({ error: getErrorMessage(error) }, { status: 400 }),
    };
  }

  const credentials = getStoreCredentials(storeNumber);

  if (!credentials.refreshToken) {
    const message = `${store.name} has no eBay token configured`;
    log.warn("ebay-import/route", "Store missing eBay token", {
      storeId,
      storeNumber,
    });
    return {
      error: NextResponse.json({ error: message }, { status: 400 }),
    };
  }

  return { store, storeNumber };
}

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("ebay-import/route", "Unauthorized eBay import stats attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedStoreId = url.searchParams.get("storeId")?.trim() ?? "";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  if (requestedStoreId && requestedStoreId !== storeSession.storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  const context = await resolveImportStore(storeSession.storeId, log);

  if ("error" in context) {
    return context.error;
  }

  try {
    const stats = await getEbayImportStats({
      storeId: storeSession.storeId,
      storeNumber: context.storeNumber,
      forceRefresh,
    });

    return NextResponse.json({
      storeId: storeSession.storeId,
      storeName: context.store.name,
      ...stats,
    });
  } catch (error) {
    log.error("ebay-import/route", "Failed to load eBay import stats", error, {
      storeId: storeSession.storeId,
      storeNumber: context.storeNumber,
    });
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("ebay-import/route", "Unauthorized eBay import attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  log.warn("ebay-import/route", "Direct import stream rejected in manual worker mode");
  return NextResponse.json(
    {
      error:
        "Manual worker mode is enabled. Start eBay imports from the job flow while the PC 1 worker shortcut is open.",
    },
    { status: 409 }
  );
}
