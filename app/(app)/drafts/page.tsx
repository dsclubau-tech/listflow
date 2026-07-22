import DraftsPageClient from "@/components/DraftsPageClient";
import { getCachedDraftsPageData } from "@/lib/drafts-page-data";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";

export default async function DraftsPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const data = await getCachedDraftsPageData(storeSession.storeId);

  return (
    <div className="min-h-full px-4 py-5 md:px-6 md:py-7 2xl:p-8">
      <DraftsPageClient products={data.products} />
    </div>
  );
}
