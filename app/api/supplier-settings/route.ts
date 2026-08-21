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

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.supplierSettings.update({
    where: { id: settings.id },
    data,
  });

  return NextResponse.json(updated);
}
