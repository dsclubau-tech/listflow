import DraftsPageClient from "@/components/DraftsPageClient";
import { getCachedDraftsPageData } from "@/lib/drafts-page-data";
import { getRenderCurrentStoreSession } from "@/lib/render-store-session";

export default async function DraftsPage() {
  const storeSession = await getRenderCurrentStoreSession();

  if (!storeSession) {
    return null;
  }

  const data = await getCachedDraftsPageData(storeSession.storeId);

  return (
    <div className="w-full">
      <DraftsPageClient products={data.products} />
    </div>
  );
}
