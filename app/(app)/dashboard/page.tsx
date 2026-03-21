import { prisma } from "@/lib/prisma";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      store: true,
      createdBy: true,
    },
  });

  // Serialize Decimal and Date fields for client component
  const serializedProducts = products.map((p) => ({
    ...p,
    price: p.price.toString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    store: {
      ...p.store,
      createdAt: p.store.createdAt.toISOString(),
      updatedAt: p.store.updatedAt.toISOString(),
    },
    createdBy: {
      ...p.createdBy,
      createdAt: p.createdBy.createdAt.toISOString(),
      updatedAt: p.createdBy.updatedAt.toISOString(),
    },
  }));

  return (
    <div className="p-8">
      <DashboardClient products={serializedProducts as never} />
    </div>
  );
}
