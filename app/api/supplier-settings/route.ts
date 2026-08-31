import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getOrCreateStoreSupplierSettings } from "@/lib/supplier-settings";

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
        orderBy: { maxPrice: "asc" },
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

  const settings = await getOrCreateStoreSupplierSettings(storeSession.storeId);

  // Only allow known fields to be updated
  const allowedFields = [
    "defaultQuantity",
    "defaultCountry",
    "defaultZipcode",
    "defaultShippingMethod",
    "defaultShippingPolicyId",
    "defaultPaymentPolicyId",
    "defaultReturnPolicyId",
    "ebayFeePercent",
    "fixedFeeAmount",
    "additionalProfitPercent",
    "additionalProfitFixed",
    "applyAdditionalProfitToExisting",
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

  const hasProfitTiers = Array.isArray(body.profitTiers);
  if (Object.keys(data).length === 0 && !hasProfitTiers) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const profitTiers = hasProfitTiers
    ? body.profitTiers
        .map((t: unknown) => {
          const item = t as Record<string, unknown>;
          return {
            maxPrice:
              typeof item?.maxPrice === "number"
                ? item.maxPrice
                : parseFloat(String(item?.maxPrice ?? "")) || 0,
            profitPercent:
              typeof item?.profitPercent === "number"
                ? item.profitPercent
                : parseFloat(String(item?.profitPercent ?? "")) || 0,
          };
        })
        .filter((t: { maxPrice: number; profitPercent: number }) => t.maxPrice > 0 && t.profitPercent > 0)
    : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    if (profitTiers !== undefined) {
      await tx.profitTier.deleteMany({
        where: { supplierSettingsId: settings.id },
      });
      if (profitTiers.length > 0) {
        await tx.profitTier.createMany({
          data: profitTiers.map((t: { maxPrice: number; profitPercent: number }) => ({
            supplierSettingsId: settings.id,
            maxPrice: t.maxPrice,
            profitPercent: t.profitPercent,
          })),
        });
      }
    }

    if (Object.keys(data).length > 0) {
      return await tx.supplierSettings.update({
        where: { id: settings.id },
        data,
        include: {
          profitTiers: {
            orderBy: { maxPrice: "asc" },
          },
        },
      });
    }

    return await tx.supplierSettings.findUniqueOrThrow({
      where: { id: settings.id },
      include: {
        profitTiers: {
          orderBy: { maxPrice: "asc" },
        },
      },
    });
  });

  return NextResponse.json(updated);
}

