import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

const SUPPLIER_NAME = "Amazon AU";

async function getOrCreateStoreSupplierSettings(storeId: string) {
  let settings = await prisma.supplierSettings.findUnique({
    where: {
      storeId_supplierName: {
        storeId,
        supplierName: SUPPLIER_NAME,
      },
    },
  });

  if (settings) {
    return settings;
  }

  const globalSettings = await prisma.supplierSettings.findFirst({
    where: { storeId: null, supplierName: SUPPLIER_NAME },
  });

  const storeNumber = await prisma.store
    .findUnique({ where: { id: storeId }, select: { name: true } })
    .then((store) => Number(store?.name.replace(/\D/g, "")) || globalSettings?.storeNumber || 1);

  settings = await prisma.supplierSettings.create({
    data: {
      storeId,
      supplierName: SUPPLIER_NAME,
      defaultQuantity: globalSettings?.defaultQuantity ?? 1,
      defaultCountry: globalSettings?.defaultCountry ?? "Australia",
      defaultZipcode: globalSettings?.defaultZipcode ?? "3170",
      defaultShippingMethod:
        globalSettings?.defaultShippingMethod ?? "Cheapest with tracking",
      defaultShippingPolicyId: globalSettings?.defaultShippingPolicyId ?? null,
      defaultPaymentPolicyId: globalSettings?.defaultPaymentPolicyId ?? null,
      defaultReturnPolicyId: globalSettings?.defaultReturnPolicyId ?? null,
      ebayFeePercent: globalSettings?.ebayFeePercent ?? 13,
      fixedFeeAmount: globalSettings?.fixedFeeAmount ?? 0.33,
      additionalProfitPercent: globalSettings?.additionalProfitPercent ?? 0,
      additionalProfitFixed: globalSettings?.additionalProfitFixed ?? 0,
      minimumProfit: globalSettings?.minimumProfit ?? 1,
      capitalizeTitle: globalSettings?.capitalizeTitle ?? false,
      autofillBrand: globalSettings?.autofillBrand ?? true,
      allowVeroKeywords: globalSettings?.allowVeroKeywords ?? false,
      privateListing: globalSettings?.privateListing ?? false,
      defaultWeightUnit: globalSettings?.defaultWeightUnit ?? "Kg",
      automaticSkuFilling: globalSettings?.automaticSkuFilling ?? true,
      minProductQuantity: globalSettings?.minProductQuantity ?? 2,
      maxShippingDays: globalSettings?.maxShippingDays ?? 25,
      primeOnly: globalSettings?.primeOnly ?? true,
      priceTrackingEnabled: globalSettings?.priceTrackingEnabled ?? false,
      autoHoldOnPriceCheckFailure:
        globalSettings?.autoHoldOnPriceCheckFailure ?? true,
      priceCheckHour: globalSettings?.priceCheckHour ?? 6,
      scrapePostcode: globalSettings?.scrapePostcode ?? "2217",
      storeNumber,
      defaultItemSpecifics: globalSettings?.defaultItemSpecifics ?? {},
    },
  });

  return settings;
}

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getOrCreateStoreSupplierSettings(storeSession.storeId);

  return NextResponse.json(settings);
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

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.supplierSettings.update({
    where: { id: settings.id },
    data,
  });

  return NextResponse.json(updated);
}
