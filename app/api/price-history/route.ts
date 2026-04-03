import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId")?.trim() || undefined;
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1
  );
  const skip = (page - 1) * PAGE_SIZE;

  const where = productId ? { productId } : {};

  const [items, total] = await Promise.all([
    prisma.priceHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip,
      include: {
        product: {
          select: {
            id: true,
            title: true,
            asin: true,
          },
        },
        variant: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
    prisma.priceHistory.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      previousPrice: item.previousPrice.toString(),
      newPrice: item.newPrice.toString(),
      previousSellPrice: item.previousSellPrice.toString(),
      newSellPrice: item.newSellPrice.toString(),
      createdAt: item.createdAt.toISOString(),
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  });
}
