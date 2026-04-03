import { prisma } from "@/lib/prisma";
import ProductsPageClient from "@/components/ProductsPageClient";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    where: { status: "IMPORTED" },
    orderBy: { createdAt: "desc" },
    include: {
      store: true,
      createdBy: true,
      priceHistory: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: {
          variants: true,
        },
      },
    },
  });

  const serializedProducts = products.map((product) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    priceHistory: product.priceHistory.map((entry) => ({
      ...entry,
      previousPrice: entry.previousPrice.toString(),
      newPrice: entry.newPrice.toString(),
      previousSellPrice: entry.previousSellPrice.toString(),
      newSellPrice: entry.newSellPrice.toString(),
      createdAt: entry.createdAt.toISOString(),
    })),
    store: {
      ...product.store,
      createdAt: product.store.createdAt.toISOString(),
      updatedAt: product.store.updatedAt.toISOString(),
    },
    createdBy: {
      ...product.createdBy,
      createdAt: product.createdBy.createdAt.toISOString(),
      updatedAt: product.createdBy.updatedAt.toISOString(),
    },
  }));

  return (
    <div className="p-8">
      <ProductsPageClient products={serializedProducts as never} />
    </div>
  );
}
