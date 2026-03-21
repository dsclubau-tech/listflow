import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildAddItemXML } from "@/lib/ebay-xml";
import { callEbayAddItem, getStoreNumber, getEbayToken } from "@/lib/ebay";

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
    // Resolve store number and get token
    const storeNumber = await getStoreNumber(product.storeId);
    const token = getEbayToken(product.store.name);

    // Build XML and call eBay
    const xml = buildAddItemXML(product, token);
    const result = await callEbayAddItem(xml, storeNumber);

    if (result.success) {
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

    // Log the error
    await prisma.uploadLog.create({
      data: {
        productId,
        storeId: product.storeId,
        userId: session.user.id,
        status: "FAILED",
        errorMessage: message,
      },
    });

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
