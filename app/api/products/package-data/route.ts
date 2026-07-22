import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { createRequestLogger } from "@/lib/logger";
import { canonicalizePackageItemSpecifics, getStoredPackageDimensions } from "@/lib/package-data-sync";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    log.warn("products/package-data", "Unauthorized package data preview request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    where: {
      storeId: storeSession.storeId,
      status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
      ebayItemId: { not: null },
    },
    select: { itemSpecifics: true },
  });
  const readyToApply = products.filter((product) =>
    Boolean(getStoredPackageDimensions(canonicalizePackageItemSpecifics(product.itemSpecifics))),
  ).length;

  return NextResponse.json({
    listed: products.length,
    readyToApply,
    missingLocalPackageData: products.length - readyToApply,
  });
}
