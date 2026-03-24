import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildAddItemXML } from "@/lib/ebay-xml";
import { callEbayAddItem, getStoreNumber } from "@/lib/ebay";
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
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 }
    );
  }

  logger.info("upload/route", "Upload request received", { productId, userId: session.user.id });

  // Fetch product with store relation
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (product.status === "IMPORTED") {
    return NextResponse.json(
      { error: "Product is already imported" },
      { status: 400 }
    );
  }

  try {
    // Resolve store number
    const storeNumber = await getStoreNumber(product.storeId);

    // Resolve template placeholders
    const finalDescription = await resolveDescriptionTemplate(product);

    // Build XML with resolved description
    const productWithResolvedDesc = { ...product, description: finalDescription };
    const xml = buildAddItemXML(productWithResolvedDesc);

    logger.info("upload/route", "Sending AddItem request to eBay", {
      productId,
      storeNumber,
      productTitle: product.title,
    });

    const result = await callEbayAddItem(xml, storeNumber);

    if (result.success) {
      logger.info("upload/route", "eBay AddItem succeeded", {
        productId,
        ebayItemId: result.itemId,
        storeNumber,
      });

      // Update product status
      await prisma.product.update({
        where: { id: productId },
        data: { status: "IMPORTED", ebayItemId: result.itemId },
      });

      // Log success
      await prisma.uploadLog.create({
        data: {
          productId,
          storeId: product.storeId,
          userId: session.user.id,
          status: "SUCCESS",
          ebayItemId: result.itemId,
        },
      });

      return NextResponse.json({ success: true, itemId: result.itemId });
    } else {
      logger.error("upload/route", "eBay AddItem failed", undefined, {
        productId,
        storeNumber,
        ebayError: result.errorMessage,
      });

      // Update product status
      await prisma.product.update({
        where: { id: productId },
        data: { status: "FAILED", errorMessage: result.errorMessage },
      });

      // Log failure
      await prisma.uploadLog.create({
        data: {
          productId,
          storeId: product.storeId,
          userId: session.user.id,
          status: "FAILED",
          errorMessage: result.errorMessage,
        },
      });

      return NextResponse.json(
        { success: false, error: result.errorMessage },
        { status: 422 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    logger.error("upload/route", "Unhandled error in upload route", err, { productId });

    // Persist error to DB
    await prisma.uploadLog.create({
      data: {
        productId,
        storeId: product.storeId,
        userId: session.user.id,
        status: "FAILED",
        errorMessage: message,
      },
    });

    // Check if this was a validation error (throws from buildAddItemXML)
    const isValidationError = message.includes("Policy") || message.includes("Category");

    return NextResponse.json(
      { success: false, error: message },
      { status: isValidationError ? 422 : 500 }
    );
  }
}
