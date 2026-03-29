import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createRequestLogger } from "@/lib/logger";
import { applyKeywordFilter } from "@/lib/keyword-filter";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await params;
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("api/products/PATCH", "Unauthorized attempt", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  log.info("api/products/PATCH", "Update request received", { id });

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    log.warn("api/products/PATCH", "Product not found", { id });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
    log.info("api/products/PATCH", "Parsing request body", {
      id,
      fields: Object.keys(body),
    });
  } catch (error) {
    log.error("api/products/PATCH", "Invalid JSON body", error, { id });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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
    log.warn("api/products/PATCH", "No valid fields to update", { id });
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  if (data.title !== undefined) {
    if (typeof data.title !== "string" || !data.title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    data.title = data.title.trim();
  }

  if (data.description !== undefined) {
    if (typeof data.description !== "string" || !data.description.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }
  }

  if (data.price !== undefined) {
    const numericPrice = Number(data.price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return NextResponse.json({ error: "Price must be greater than 0" }, { status: 400 });
    }
    data.price = numericPrice;
  }

  if (data.quantity !== undefined) {
    const numericQuantity = Number(data.quantity);
    if (!Number.isInteger(numericQuantity) || numericQuantity < 1) {
      return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
    }
    data.quantity = numericQuantity;
  }

  if (data.category !== undefined) {
    if (typeof data.category !== "string" || !/^\d+$/.test(data.category.trim())) {
      return NextResponse.json(
        { error: "Category must be a numeric eBay Category ID" },
        { status: 400 },
      );
    }
    data.category = data.category.trim();
  }

  if (data.images !== undefined) {
    if (
      !Array.isArray(data.images) ||
      data.images.length === 0 ||
      data.images.some((image) => typeof image !== "string" || !image.trim())
    ) {
      return NextResponse.json(
        { error: "At least one valid image URL is required" },
        { status: 400 },
      );
    }

    data.images = data.images.map((image) => image.trim());
  }

  try {
    const titleStr = typeof data.title === "string" ? data.title : undefined;
    const descStr = typeof data.description === "string" ? data.description : undefined;
    let removedKeywords: string[] = [];

    if (titleStr || descStr) {
      const filtered = await applyKeywordFilter(
        titleStr || product.title,
        descStr || product.description,
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

    log.info("api/products/PATCH", "Update successful", { id });
    return NextResponse.json({ ...updated, removedKeywords });
  } catch (error) {
    log.error("api/products/PATCH", "Database update failed", error, { id });
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await params;
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("api/products/DELETE", "Unauthorized delete attempt", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    log.warn("api/products/DELETE", "Product not found", { id });
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  try {
    await prisma.uploadLog.deleteMany({ where: { productId: id } });
    await prisma.variant.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });

    log.info("api/products/DELETE", "Product deleted", { id });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("api/products/DELETE", "Delete failed", error, { id });
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
