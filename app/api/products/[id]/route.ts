import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { applyKeywordFilter } from "@/lib/keyword-filter";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;

  if (!session?.user) {
    logger.error("api/products/PATCH", "Unauthorized attempt", undefined, { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logger.info("api/products/PATCH", "Update request received", { id, userId: session.user.id });

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    logger.error("api/products/PATCH", "Product not found", undefined, { id });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
    logger.info("api/products/PATCH", "Parsing request body", { id, fields: Object.keys(body) });
  } catch (err) {
    logger.error("api/products/PATCH", "Invalid JSON body", err, { id });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow updating specific fields
  const allowedFields = [
    "title",
    "description",
    "price",
    "quantity",
    "category",
    "categoryName",
    "condition",
    "images",
    "itemSpecifics",
    "shippingPolicyId",
    "returnPolicyId",
    "paymentPolicyId",
    "templateId",
  ];

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    logger.error("api/products/PATCH", "No valid fields to update", undefined, { id });
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  try {
    // Apply keyword blacklist filter before saving
    const titleStr = typeof data.title === "string" ? data.title : undefined;
    const descStr = typeof data.description === "string" ? data.description : undefined;
    let removedKeywords: string[] = [];

    if (titleStr || descStr) {
      const filtered = await applyKeywordFilter(
        titleStr || product.title,
        descStr || product.description
      );
      if (titleStr) data.title = filtered.title;
      if (descStr) data.description = filtered.description;
      removedKeywords = filtered.removedKeywords;
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
      include: { store: true, createdBy: true },
    });

    logger.info("api/products/PATCH", "Update successful", { id });
    return NextResponse.json({ ...updated, removedKeywords });
  } catch (err) {
    logger.error("api/products/PATCH", "Database update failed", err, { id });
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    // Delete related UploadLogs first to avoid FK constraint errors
    await prisma.uploadLog.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });

    logger.info("api/products/DELETE", "Product deleted", { id, userId: session.user.id });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("api/products/DELETE", "Delete failed", err, { id });
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
