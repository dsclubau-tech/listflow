import { prisma } from "@/lib/prisma";
import DraftsPageClient from "@/components/DraftsPageClient";

export default async function DraftsPage() {
  const products = await prisma.product.findMany({
    where: {
      status: {
        in: ["DRAFT", "FAILED"],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      store: true,
      createdBy: true,
    },
  });

  const serializedProducts = products.map((product) => ({
    ...product,
    price: product.price.toString(),
    amazonPrice: product.amazonPrice?.toString() ?? null,
    lastPriceCheck: product.lastPriceCheck?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
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
      <DraftsPageClient products={serializedProducts as never} />
    </div>
  );
}
