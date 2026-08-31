import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureDefaultVariantForProduct,
  normalizeVariantPayload,
  serializeVariant,
} from "@/lib/variants";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidateProductCaches } from "@/lib/cache-tags";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
    select: { id: true, itemSpecifics: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { createdAt: "asc" },
  });

  if (variants.length === 0) {
    await ensureDefaultVariantForProduct(productId);
    variants = await prisma.variant.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
    });
  }

  const productSpecs =
    product.itemSpecifics && typeof product.itemSpecifics === "object"
      ? (product.itemSpecifics as Record<string, string>)
      : {};

  return NextResponse.json(
    variants.map((v) => {
      const serialized = serializeVariant(v);
      if (!serialized.itemSpecifics._shippingFee && productSpecs._shippingFee) {
        serialized.itemSpecifics._shippingFee = String(productSpecs._shippingFee);
      }
      if (!serialized.itemSpecifics._rawPrice && productSpecs._rawPrice) {
        serialized.itemSpecifics._rawPrice = String(productSpecs._rawPrice);
      }
      return serialized;
    })
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await params;

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: storeSession.storeId },
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

    invalidateProductCaches(storeSession.storeId);

    return NextResponse.json(serializeVariant(variant), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create variant";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
