import EbayImportClient from "@/components/EbayImportClient";
import { prisma } from "@/lib/prisma";

export default async function EbayImportPage() {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-8">
      <EbayImportClient stores={stores} />
    </div>
  );
}
