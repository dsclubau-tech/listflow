import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find or create the Amazon AU settings record
  let settings = await prisma.supplierSettings.findFirst({
    where: { supplierName: "Amazon AU" },
  });

  if (!settings) {
    settings = await prisma.supplierSettings.create({
      data: { supplierName: "Amazon AU" },
    });
  }

  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Find or create the settings record first
  let settings = await prisma.supplierSettings.findFirst({
    where: { supplierName: "Amazon AU" },
  });

  if (!settings) {
    settings = await prisma.supplierSettings.create({
      data: { supplierName: "Amazon AU" },
    });
  }

  // Only allow known fields to be updated
  const allowedFields = [
    "defaultQuantity",
    "defaultCountry",
    "defaultZipcode",
    "defaultShippingMethod",
    "defaultTemplateId",
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
    "priceCheckHour",
    "scrapePostcode",
    "storeNumber",
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
