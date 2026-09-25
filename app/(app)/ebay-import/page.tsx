import EbayImportClient from "@/components/EbayImportClient";
import { prisma } from "@/lib/prisma";
import { getRenderCurrentStoreSession } from "@/lib/render-store-session";
import { redirect } from "next/navigation";

export default async function EbayImportPage() {
  const storeSession = await getRenderCurrentStoreSession();

  if (!storeSession) {
    return null;
  }

  const stores = await prisma.store.findMany({
    where: { id: storeSession.storeId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="w-full">
      <EbayImportClient stores={stores} />
    </div>
  );
}
