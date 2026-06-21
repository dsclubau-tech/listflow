import { auth } from "@/auth";
import { getStoreCredentials, getStoreNumber } from "@/lib/ebay";
import { getEbayImportStats, importEbayListings } from "@/lib/ebay-import";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";

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

  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    log.error("ebay-import/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId =
    body && typeof body === "object" && "storeId" in body
      ? String((body as { storeId?: unknown }).storeId ?? "").trim()
      : storeSession.storeId;
  const quantity =
    body && typeof body === "object" && "quantity" in body
      ? Number((body as { quantity?: unknown }).quantity)
      : 0;

  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: "quantity must be at least 1" },
      { status: 400 },
    );
  }

  if (storeId && storeId !== storeSession.storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  const context = await resolveImportStore(storeSession.storeId, log);

  if ("error" in context) {
    return context.error;
  }

  let streamOpen = true;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: object) => {
        if (!streamOpen) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          streamOpen = false;
        }
      };

      try {
        log.info("ebay-import/route", "Starting eBay import stream", {
          storeId: storeSession.storeId,
          storeNumber: context.storeNumber,
          quantity,
        });

        const userId = await getInternalUserId();
        const result = await importEbayListings({
          storeId: storeSession.storeId,
          storeNumber: context.storeNumber,
          userId,
          quantity,
          onProgress: (progress) => {
            send({ type: "progress", ...progress });
          },
        });

        send({ type: "complete", ...result });
      } catch (error) {
        log.error("ebay-import/route", "eBay import stream failed", error, {
          storeId,
          storeNumber: context.storeNumber,
        });
        send({ type: "error", message: getErrorMessage(error) });
      } finally {
        if (streamOpen) {
          try {
            controller.close();
          } catch {
            streamOpen = false;
          }
        }
      }
    },
    cancel() {
      streamOpen = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
