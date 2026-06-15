import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildAddItemXML } from "@/lib/ebay-xml";
import { callEbayAddItem, getStoreNumber } from "@/lib/ebay";
import { resolveDescriptionTemplate } from "@/lib/template-resolver";
import { createRequestLogger } from "@/lib/logger";
import { ProductStatus } from "@/app/generated/prisma/enums";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(request, storeSession ? { storeId: storeSession.storeId } : {});

  if (!session?.user || !storeSession) {
    log.warn("upload/route", "Unauthorized upload attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    log.error("upload/route", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { productId } = body;

  if (!productId) {
    log.warn("upload/route", "Upload request missing productId");
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 },
    );
  }

  log.info("upload/route", "Upload request received", { productId });

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
    include: { store: true },
  });

  if (!product) {
    log.warn("upload/route", "Product not found for upload", { productId });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (
    product.ebayItemId ||
    product.status === ProductStatus.IMPORTED ||
    product.status === ProductStatus.ON_HOLD
  ) {
    log.warn("upload/route", "Rejected upload for already listed product", {
      productId,
      status: product.status,
      ebayItemId: product.ebayItemId,
    });
    return NextResponse.json(
      { error: "Product is already listed on eBay" },
      { status: 400 },
    );
  }

  try {
    const userId = await getInternalUserId();
    const storeNumber = await getStoreNumber(product.storeId);
    const finalDescription = await resolveDescriptionTemplate(product);
    const productWithResolvedDesc = { ...product, description: finalDescription };
    const xml = buildAddItemXML(productWithResolvedDesc);

    log.info("upload/route", "Sending AddItem request to eBay", {
      productId,
      storeNumber,
      productTitle: product.title,
    });

    const result = await callEbayAddItem(xml, storeNumber);

    if (result.success) {
      log.info("upload/route", "eBay AddItem succeeded", {
        productId,
        ebayItemId: result.itemId,
        storeNumber,
      });

      await prisma.product.update({
        where: { id: productId },
        data: { status: "IMPORTED", ebayItemId: result.itemId },
      });

      await prisma.uploadLog.create({
        data: {
          productId,
          storeId: product.storeId,
          userId,
          status: "SUCCESS",
          ebayItemId: result.itemId,
        },
      });

      return NextResponse.json({ success: true, itemId: result.itemId });
    }

    log.error("upload/route", "eBay AddItem failed", undefined, {
      productId,
      storeNumber,
      ebayError: result.errorMessage,
    });

    await prisma.product.update({
      where: { id: productId },
      data: { status: "FAILED", errorMessage: result.errorMessage },
    });

    await prisma.uploadLog.create({
      data: {
          productId,
          storeId: product.storeId,
          userId,
          status: "FAILED",
        errorMessage: result.errorMessage,
      },
    });

    return NextResponse.json(
      { success: false, error: result.errorMessage },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    log.error("upload/route", "Unhandled error in upload route", error, {
      productId,
    });

    await prisma.uploadLog.create({
      data: {
        productId,
        storeId: product.storeId,
        userId: await getInternalUserId(),
        status: "FAILED",
        errorMessage: message,
      },
    });

    const isValidationError =
      message.includes("Policy") || message.includes("Category");

    return NextResponse.json(
      { success: false, error: message },
      { status: isValidationError ? 422 : 500 },
    );
  }
}
