import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureDefaultVariantForProduct,
  normalizeVariantPayload,
  serializeVariant,
} from "@/lib/variants";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  await ensureDefaultVariantForProduct(productId);

  const variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(variants.map(serializeVariant));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const data = normalizeVariantPayload(body);

    const variant = await prisma.variant.create({
      data: {
        ...data,
        productId,
      },
    });

    return NextResponse.json(serializeVariant(variant), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create variant";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
