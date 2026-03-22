import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

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
    const updated = await prisma.product.update({
      where: { id },
      data,
      include: { store: true, createdBy: true },
    });

    logger.info("api/products/PATCH", "Update successful", { id });
    return NextResponse.json(updated);
  } catch (err) {
    logger.error("api/products/PATCH", "Database update failed", err, { id });
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }
}
