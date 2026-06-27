import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normalizeVariantPayload, serializeVariant } from "@/lib/variants";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidateProductCaches } from "@/lib/cache-tags";

async function findVariant(productId: string, variantId: string, storeId: string) {
  return prisma.variant.findFirst({
    where: {
      id: variantId,
      productId,
      product: { storeId },
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId, variantId } = await params;
  const existing = await findVariant(productId, variantId, storeSession.storeId);

  if (!existing) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const data = normalizeVariantPayload(body);
    const variant = await prisma.variant.update({
      where: { id: variantId },
      data,
    });

    invalidateProductCaches(storeSession.storeId);

    return NextResponse.json(serializeVariant(variant));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update variant";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId, variantId } = await params;
  const existing = await findVariant(productId, variantId, storeSession.storeId);

  if (!existing) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const count = await prisma.variant.count({
    where: { productId, product: { storeId: storeSession.storeId } },
  });

  if (count <= 1) {
    return NextResponse.json(
      { error: "Each product must keep at least one variant." },
      { status: 400 }
    );
  }

  await prisma.variant.delete({
    where: { id: variantId },
  });

  invalidateProductCaches(storeSession.storeId);

  return NextResponse.json({ success: true });
}
