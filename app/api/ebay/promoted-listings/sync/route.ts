import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { invalidateProductCaches } from "@/lib/cache-tags";
import { getEbayPromotedListingSync, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";

const UPDATE_CHUNK_SIZE = 25;

type SyncProgressPayload = {
  type: "progress" | "done" | "error";
  phase: string;
  total: number;
  processed: number;
  promoted: number;
  notPromoted: number;
  fixedRate: number;
  dynamic: number;
  percent: number;
  syncedAt?: string;
  error?: string;
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function parseScopedProductIds(body: unknown) {
  if (!body || typeof body !== "object" || !("productIds" in body)) {
    return null;
  }

  const value = (body as { productIds?: unknown }).productIds;

  if (!Array.isArray(value)) {
    throw new Error("productIds must be an array.");
  }

  return Array.from(
    new Set(
      value
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
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

  let scopedProductIds: string[] | null = null;
  try {
    const body = await request.json().catch(() => null);
    scopedProductIds = parseScopedProductIds(body);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid selected products payload.",
      },
      { status: 400 },
    );
  }

  if (scopedProductIds && scopedProductIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one product to sync eBay ads." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let total = 0;
      let processed = 0;
      let promoted = 0;
      let notPromoted = 0;
      let fixedRate = 0;
      let dynamic = 0;

      function emit(payload: Partial<SyncProgressPayload>) {
        const percent =
          payload.percent ??
          (total > 0 ? Math.round((processed / total) * 100) : 0);

        const event: SyncProgressPayload = {
          type: payload.type ?? "progress",
          phase: payload.phase ?? "Syncing eBay ads",
          total,
          processed,
          promoted,
          notPromoted,
          fixedRate,
          dynamic,
          percent,
          syncedAt: payload.syncedAt,
          error: payload.error,
        };

        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      try {
        emit({
          phase: scopedProductIds
            ? "Loading selected ListFlow listings"
            : "Loading ListFlow listings",
          percent: 5,
        });

        const listedProducts = await prisma.product.findMany({
          where: {
            storeId: storeSession.storeId,
            status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
            ebayItemId: { not: null },
            ...(scopedProductIds ? { id: { in: scopedProductIds } } : {}),
          },
          select: {
            id: true,
            ebayItemId: true,
          },
        });
        const syncedAt = new Date();
        total = listedProducts.length;

        if (total === 0) {
          emit({
            type: "done",
            phase: scopedProductIds
              ? "No selected eBay listings to sync"
              : "No eBay listings to sync",
            percent: 100,
            syncedAt: syncedAt.toISOString(),
          });
          return;
        }

        emit({ phase: "Reading eBay promoted campaigns", percent: 15 });

        const storeNumber = await getStoreNumber(storeSession.storeId);
        const promotedByListingId = await getEbayPromotedListingSync(
          storeNumber,
          listedProducts.map((product) => String(product.ebayItemId ?? "").trim()),
        );

        const updatePhase = scopedProductIds
          ? "Updating selected ListFlow ad status"
          : "Updating ListFlow ad status";

        emit({ phase: updatePhase });

        for (const productChunk of chunk(listedProducts, UPDATE_CHUNK_SIZE)) {
          const chunkUpdates = productChunk.map((product) => {
            const listingId = String(product.ebayItemId ?? "").trim();
            const promotedRecord = promotedByListingId.get(listingId);

            if (!promotedRecord) {
              return {
                id: product.id,
                promoted: false,
                fixedRate: false,
                dynamic: false,
                data: {
                  promotedAdStatus: "NOT_PROMOTED" as const,
                  promotedAdPercent: 0,
                  promotedAdCampaignId: null,
                  promotedAdCampaignName: null,
                  promotedAdRateStrategy: "UNKNOWN" as const,
                  promotedAdSyncedAt: syncedAt,
                },
              };
            }

            return {
              id: product.id,
              promoted: true,
              fixedRate: promotedRecord.rateStrategy === "FIXED",
              dynamic: promotedRecord.rateStrategy === "DYNAMIC",
              data: {
                promotedAdStatus: "PROMOTED" as const,
                promotedAdPercent: promotedRecord.bidPercentage ?? 0,
                promotedAdCampaignId: promotedRecord.campaignId,
                promotedAdCampaignName: promotedRecord.campaignName,
                promotedAdRateStrategy: promotedRecord.rateStrategy,
                promotedAdSyncedAt: syncedAt,
              },
            };
          });

          await Promise.all(
            chunkUpdates.map((update) =>
              prisma.product.update({
                where: { id: update.id },
                data: update.data,
              }),
            ),
          );

          for (const update of chunkUpdates) {
            processed += 1;

            if (update.promoted) {
              promoted += 1;
            } else {
              notPromoted += 1;
            }

            if (update.fixedRate) {
              fixedRate += 1;
            } else if (update.dynamic) {
              dynamic += 1;
            }
          }

          emit({ phase: updatePhase });
        }

        invalidateProductCaches(storeSession.storeId);

        log.info("ebay/promoted-listings/sync", "Synced promoted listing data", {
          listedProductCount: total,
          scopedProductCount: scopedProductIds?.length ?? null,
          promoted,
          notPromoted,
          fixedRate,
          dynamic,
        });

        emit({
          type: "done",
          phase: scopedProductIds
            ? "Selected eBay ad sync complete"
            : "eBay ad sync complete",
          percent: 100,
          syncedAt: syncedAt.toISOString(),
        });
      } catch (error) {
        log.error("ebay/promoted-listings/sync", "Failed to sync promoted listing data", error);
        emit({
          type: "error",
          phase: "eBay ad sync failed",
          error:
            error instanceof Error
              ? error.message
              : "Failed to sync eBay promoted listings.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
