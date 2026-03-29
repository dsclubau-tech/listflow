import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildEndItemXML } from "@/lib/ebay-xml";
import { callEbayEndItem, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("end-listing/route", "Unauthorized end-listing attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: true },
  });

  if (!product) {
    log.warn("end-listing/route", "Product not found for end-listing", { productId });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "IMPORTED" || !product.ebayItemId) {
    log.warn("end-listing/route", "Rejected end-listing for product not on eBay", {
      productId,
    });
    return NextResponse.json(
      { error: "Product is not currently listed on eBay" },
      { status: 400 },
    );
  }

  log.info("end-listing/route", "End listing request received", {
    productId,
    ebayItemId: product.ebayItemId,
  });

  try {
    const storeNumber = await getStoreNumber(product.storeId);
    const xml = buildEndItemXML(product.ebayItemId);

    log.info("end-listing/route", "Sending EndItem request to eBay", {
      productId,
      ebayItemId: product.ebayItemId,
      storeNumber,
    });

    const result = await callEbayEndItem(xml, storeNumber);

    if (result.success) {
      log.info("end-listing/route", "eBay EndItem succeeded", {
        productId,
        ebayItemId: product.ebayItemId,
        storeNumber,
      });

      await prisma.product.update({
        where: { id: productId },
        data: {
          status: "DRAFT",
          ebayItemId: null,
          errorMessage: null,
        },
      });

      return NextResponse.json({ success: true });
    }

    log.error("end-listing/route", "eBay EndItem failed", undefined, {
      productId,
      ebayItemId: product.ebayItemId,
      storeNumber,
      ebayError: result.errorMessage,
    });

    return NextResponse.json(
      { success: false, error: result.errorMessage },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("end-listing/route", "Unhandled error in end listing route", error, {
      productId,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
