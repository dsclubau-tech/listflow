import { ProductStatus } from "@/app/generated/prisma/enums";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";

const MAX_SUGGESTIONS = 8;

function firstImage(images: string[]) {
  return images.find((image) => /^https?:\/\//i.test(image)) ?? null;
}

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query =
    new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";

  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const products = await prisma.product.findMany({
    where: {
      storeId: storeSession.storeId,
      status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { fullTitle: { contains: query, mode: "insensitive" } },
        { id: { contains: query, mode: "insensitive" } },
        { asin: { contains: query, mode: "insensitive" } },
        { ebayItemId: { contains: query, mode: "insensitive" } },
        { internalNote: { contains: query, mode: "insensitive" } },
        { itemSpecifics: { path: ["Brand"], string_contains: query } },
        { itemSpecifics: { path: ["brand"], string_contains: query } },
        {
          variants: {
            some: { sku: { contains: query, mode: "insensitive" } },
          },
        },
        {
          variants: {
            some: { id: { contains: query, mode: "insensitive" } },
          },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_SUGGESTIONS,
    select: {
      id: true,
      title: true,
      asin: true,
      ebayItemId: true,
      images: true,
    },
  });

  return NextResponse.json({
    suggestions: products.map((product) => ({
      id: product.id,
      title: product.title,
      asin: product.asin,
      ebayItemId: product.ebayItemId,
      image: firstImage(product.images),
    })),
  });
}
