import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getFastProductSearchPage } from "@/lib/fast-product-search";
import { normalizeProductsQuery } from "@/lib/product-filter-query";
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

  if (query.length < 3) {
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
  const matches = await getFastProductSearchPage({
    storeId: storeSession.storeId,
    query: normalizeProductsQuery({ q: query }),
    minimumProductQuantity: 2,
    take: MAX_SUGGESTIONS,
    skip: 0,
    includeCount: false,
  });
  const products = matches.ids.length ? await prisma.product.findMany({
    where: { storeId: storeSession.storeId, id: { in: matches.ids } },
    select,
  }) : [];
  const order = new Map(matches.ids.map((id, index) => [id, index]));
  products.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));

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
