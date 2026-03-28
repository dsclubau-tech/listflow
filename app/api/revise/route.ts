import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildReviseItemXML } from "@/lib/ebay-xml";
import { callEbayReviseItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
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

  const { productId } = body;

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

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

  try {
    const storeNumber = await getStoreNumber(product.storeId);

    // Resolve template placeholders
    const finalDescription = await resolveDescriptionTemplate(product);
    const productWithResolvedDesc = { ...product, description: finalDescription };
    const xml = buildReviseItemXML(productWithResolvedDesc);

    logger.info("revise/route", "Sending ReviseItem request to eBay", {
      productId,
      ebayItemId: product.ebayItemId,
      storeNumber,
    });

    const result = await callEbayReviseItem(xml, storeNumber);

    if (result.success) {
      await prisma.product.update({
        where: { id: productId },
        data: {
          status: "IMPORTED",
          errorMessage: null,
        },
      });

      logger.info("revise/route", "eBay ReviseItem succeeded", {
        productId,
        ebayItemId: product.ebayItemId,
      });
      return NextResponse.json({ success: true });
    } else {
      await prisma.product.update({
        where: { id: productId },
        data: {
          errorMessage: result.errorMessage || "Revise failed",
        },
      });

      logger.error("revise/route", "eBay ReviseItem failed", undefined, {
        productId,
        ebayError: result.errorMessage,
      });
      return NextResponse.json(
        { success: false, error: result.errorMessage },
        { status: 422 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    await prisma.product.update({
      where: { id: productId },
      data: {
        errorMessage: message,
      },
    });

    logger.error("revise/route", "Unhandled error in revise route", err, { productId });
    const isValidationError =
      message.includes("Policy") ||
      message.includes("Category") ||
      message.includes("Price") ||
      message.includes("Quantity");

    return NextResponse.json(
      { success: false, error: message },
      { status: isValidationError ? 422 : 500 }
    );
  }
}
