import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildEndItemXML } from "@/lib/ebay-xml";
import { callEbayEndItem, getStoreNumber } from "@/lib/ebay";
import { logger } from "@/lib/logger";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  // Fetch product with store relation
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status !== "IMPORTED" || !product.ebayItemId) {
    return NextResponse.json(
      { error: "Product is not currently listed on eBay" },
      { status: 400 }
    );
  }

  logger.info("end-listing/route", "End listing request received", {
    productId,
    ebayItemId: product.ebayItemId,
    userId: session.user.id,
  });

  try {
    const storeNumber = await getStoreNumber(product.storeId);
    const xml = buildEndItemXML(product.ebayItemId);

    logger.info("end-listing/route", "Sending EndItem request to eBay", {
      productId,
      ebayItemId: product.ebayItemId,
      storeNumber,
    });

    const result = await callEbayEndItem(xml, storeNumber);

    if (result.success) {
      logger.info("end-listing/route", "eBay EndItem succeeded", {
        productId,
        ebayItemId: product.ebayItemId,
        storeNumber,
      });

      // Reset product status to DRAFT and clear the eBay item ID
      await prisma.product.update({
        where: { id: productId },
        data: {
          status: "DRAFT",
          ebayItemId: null,
          errorMessage: null,
        },
      });

      return NextResponse.json({ success: true });
    } else {
      logger.error("end-listing/route", "eBay EndItem failed", undefined, {
        productId,
        ebayItemId: product.ebayItemId,
        storeNumber,
        ebayError: result.errorMessage,
      });

      return NextResponse.json(
        { success: false, error: result.errorMessage },
        { status: 422 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("end-listing/route", "Unhandled error in end listing route", err, {
      productId,
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
