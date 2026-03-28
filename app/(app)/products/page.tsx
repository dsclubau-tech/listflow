import { prisma } from "@/lib/prisma";
import ProductsPageClient from "@/components/ProductsPageClient";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    where: { status: "IMPORTED" },
    orderBy: { createdAt: "desc" },
    include: {
      store: true,
      createdBy: true,
    },
  });

  const serializedProducts = products.map((product) => ({
    ...product,
    price: product.price.toString(),
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
      <ProductsPageClient products={serializedProducts as never} />
    </div>
  );
}
