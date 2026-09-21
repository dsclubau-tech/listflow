import { ProductStatus } from "@/app/generated/prisma/enums";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { buildProductSearchWhere, rankProductSearchResults } from "@/lib/product-search";
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

  const select = {
    id: true,
    title: true,
    asin: true,
    ebayItemId: true,
    fullTitle: true,
    updatedAt: true,
    variants: { select: { id: true, sku: true } },
    images: true,
  } as const;
  const baseWhere = {
    storeId: storeSession.storeId,
    status: { in: [ProductStatus.IMPORTED, ProductStatus.ON_HOLD] },
  };
  const [exactProducts, matchingProducts] = await Promise.all([
    prisma.product.findMany({
      where: {
        ...baseWhere,
        OR: [
          { id: { equals: query, mode: "insensitive" as const } },
          { asin: { equals: query, mode: "insensitive" as const } },
          { ebayItemId: { equals: query, mode: "insensitive" as const } },
          { variants: { some: { id: { equals: query, mode: "insensitive" as const } } } },
          { variants: { some: { sku: { equals: query, mode: "insensitive" as const } } } },
        ],
      },
      take: MAX_SUGGESTIONS,
      select,
    }),
    prisma.product.findMany({
    where: {
      ...baseWhere,
      ...buildProductSearchWhere(query),
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_SUGGESTIONS * 5,
    select,
    }),
  ]);
  const products = Array.from(
    new Map([...exactProducts, ...matchingProducts].map((product) => [product.id, product])).values(),
  );

  return NextResponse.json({
    suggestions: rankProductSearchResults(products, query)
      .slice(0, MAX_SUGGESTIONS)
      .map((product) => ({
      id: product.id,
      title: product.title,
      asin: product.asin,
      ebayItemId: product.ebayItemId,
      image: firstImage(product.images),
      })),
  });
}
