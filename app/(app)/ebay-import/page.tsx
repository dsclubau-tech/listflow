import EbayImportClient from "@/components/EbayImportClient";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";

export default async function EbayImportPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const stores = await prisma.store.findMany({
    where: { id: storeSession.storeId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="min-h-full px-4 py-5 md:px-6 md:py-7 2xl:p-8">
      <EbayImportClient stores={stores} />
    </div>
  );
}
