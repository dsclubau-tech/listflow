import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getOrCreateStoreSupplierSettings } from "@/lib/supplier-settings";
import { invalidateStoreCaches } from "@/lib/cache-tags";
import { resolveEbayLocationMetadata, validateAuPostcodeLocation } from "@/lib/ebay-location";
import { Prisma } from "@/app/generated/prisma/client";
import { applyLocationToDraftSpecifics, isUnpublishedDraftLocationTarget } from "@/lib/supplier-location-propagation";
import { resolveAmazonDeliveryPostcode } from "@/lib/amazon-delivery-postcode";
import {
  normalizeTier,
  type ProfitTierConfig,
  type NormalizedTier,
} from "@/lib/profit-tiers";

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseSettings = await getOrCreateStoreSupplierSettings(storeSession.storeId);
  const settings = await prisma.supplierSettings.findUnique({
    where: { id: baseSettings.id },
    include: {
      profitTiers: {
        orderBy: [{ minPrice: "asc" }, { maxPrice: "asc" }],
      },
    },
  });

  return NextResponse.json(settings ?? baseSettings);
}

export async function PATCH(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.minProductQuantity !== undefined &&
      (!Number.isSafeInteger(body.minProductQuantity) || body.minProductQuantity < 1)) {
    return NextResponse.json({ error: "Minimum Product Quantity must be a positive integer." }, { status: 400 });
  }

  const settings = await getOrCreateStoreSupplierSettings(storeSession.storeId);
  for (const field of ["defaultCountry", "defaultZipcode"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be text.` }, { status: 400 });
    }
  }
  if (body.defaultLocationText !== undefined &&
      body.defaultLocationText !== null &&
      typeof body.defaultLocationText !== "string") {
    return NextResponse.json({ error: "Selected suburb must be text." }, { status: 400 });
  }

  // Only allow known fields to be updated
  const allowedFields = [
    "defaultQuantity",
    "defaultCountry",
    "defaultZipcode",
    "defaultLocationText",
    "defaultShippingMethod",
    "defaultShippingPolicyId",
    "defaultPaymentPolicyId",
    "defaultReturnPolicyId",
    "ebayFeePercent",
    "fixedFeeAmount",
    "defaultUploadProfitPercent",
    "defaultUploadProfitFixed",
    "minimumProfit",
    "capitalizeTitle",
    "autofillBrand",
    "allowVeroKeywords",
    "privateListing",
    "defaultWeightUnit",
    "automaticSkuFilling",
    "minProductQuantity",
    "maxShippingDays",
    "primeOnly",
    "priceTrackingEnabled",
    "autoHoldOnPriceCheckFailure",
    "priceCheckHour",
    "scrapePostcode",
    "defaultItemSpecifics",
  ];

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  if (data.scrapePostcode !== undefined) {
    try {
      data.scrapePostcode = resolveAmazonDeliveryPostcode(data.scrapePostcode);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Amazon Delivery Postcode." }, { status: 400 });
    }
  }

  const nextCountry = typeof data.defaultCountry === "string" ? data.defaultCountry : settings.defaultCountry;
  const nextPostcode = typeof data.defaultZipcode === "string" ? data.defaultZipcode : settings.defaultZipcode;
  const nextLocation = data.defaultLocationText === null || typeof data.defaultLocationText === "string"
    ? data.defaultLocationText : settings.defaultLocationText;
  const locationChanged =
    nextCountry !== settings.defaultCountry ||
    nextPostcode !== settings.defaultZipcode ||
    nextLocation !== settings.defaultLocationText;
  if (locationChanged) {
    const locationError = validateAuPostcodeLocation(nextPostcode, nextCountry, nextLocation);
    if (locationError) return NextResponse.json({ error: locationError }, { status: 400 });
    data.defaultLocationText = nextLocation
      ? resolveEbayLocationMetadata({ country: nextCountry, postalCode: nextPostcode, location: nextLocation }).location
      : null;
  }

  if (data.defaultUploadProfitPercent !== undefined) {
    data.additionalProfitPercent = data.defaultUploadProfitPercent;
  }
  if (data.defaultUploadProfitFixed !== undefined) {
    data.additionalProfitFixed = data.defaultUploadProfitFixed;
  }

  const hasProfitTiers = Array.isArray(body.profitTiers);
  if (Object.keys(data).length === 0 && !hasProfitTiers) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const profitTiers = hasProfitTiers
    ? (body.profitTiers as unknown[])
        .map((t) => normalizeTier(t as ProfitTierConfig))
        .filter((t): t is NormalizedTier => t !== null)
    : undefined;

  const result = await prisma.$transaction(async (tx) => {
    let draftLocationUpdated = 0;
    let draftLocationSkipped = 0;
    if (profitTiers !== undefined) {
      await tx.profitTier.deleteMany({
        where: { supplierSettingsId: settings.id },
      });
      if (profitTiers.length > 0) {
        await tx.profitTier.createMany({
          data: profitTiers.map((t) => ({
            supplierSettingsId: settings.id,
            tierType: t.tierType,
            minPrice: t.minPrice,
            maxPrice: t.maxPrice > 0 ? t.maxPrice : null,
            profitPercent: t.profitPercent,
          })),
        });
      }
    }

    const updated = Object.keys(data).length > 0
      ? await tx.supplierSettings.update({
        where: { id: settings.id },
        data,
        include: {
          profitTiers: {
            orderBy: [{ minPrice: "asc" }, { maxPrice: "asc" }],
          },
        },
      })
      : await tx.supplierSettings.findUniqueOrThrow({
      where: { id: settings.id },
      include: {
        profitTiers: {
          orderBy: [{ minPrice: "asc" }, { maxPrice: "asc" }],
        },
      },
    });

    if (locationChanged) {
      const metadata = resolveEbayLocationMetadata({
        country: nextCountry,
        postalCode: nextPostcode,
        location: nextLocation,
      });
      // Upload-job creation locks the same product rows before creating its job.
      // Taking the locks first makes the active-job snapshot stable.
      await tx.$queryRaw`
        SELECT "id" FROM "Product"
        WHERE "storeId" = ${storeSession.storeId}
          AND "status"::text IN ('DRAFT', 'FAILED')
          AND "ebayItemId" IS NULL
        ORDER BY "id" FOR UPDATE
      `;
      const activeUploads = await tx.ebayActionJob.findMany({
        where: {
          storeId: storeSession.storeId,
          type: "UPLOAD_LISTING",
          status: { in: ["QUEUED", "RUNNING", "CANCELLING"] },
        },
        select: { productIds: true },
      });
      const activeIds = new Set(activeUploads.flatMap((job) => job.productIds));
      const drafts = await tx.product.findMany({
        where: {
          storeId: storeSession.storeId,
          status: { in: ["DRAFT", "FAILED"] },
          ebayItemId: null,
        },
        select: { id: true, itemSpecifics: true, status: true, ebayItemId: true },
      });
      for (const draft of drafts) {
        if (!isUnpublishedDraftLocationTarget({
          status: draft.status,
          ebayItemId: draft.ebayItemId,
          activeUpload: activeIds.has(draft.id),
        })) {
          draftLocationSkipped += 1;
          continue;
        }
        await tx.product.update({
          where: { id: draft.id },
          data: {
            itemSpecifics: applyLocationToDraftSpecifics(
              draft.itemSpecifics,
              metadata,
            ) as Prisma.InputJsonValue,
          },
        });
        draftLocationUpdated += 1;
      }
    }
    return { updated, draftLocationUpdated, draftLocationSkipped };
  }, { timeout: 120000 });

  if (data.minProductQuantity !== undefined || locationChanged) {
    invalidateStoreCaches(storeSession.storeId, ["products", "drafts", "actionCenter"]);
  }
  return NextResponse.json({ ...result.updated, draftLocationUpdated: result.draftLocationUpdated, draftLocationSkipped: result.draftLocationSkipped });
}

