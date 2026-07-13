import PriceTrackerClient from "@/components/PriceTrackerClient";
import { getCachedPriceTrackerPageData } from "@/lib/price-tracker-page-data";
import { getCurrentStoreSession } from "@/lib/store-session";
import { redirect } from "next/navigation";

export default async function PriceTrackerPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const data = await getCachedPriceTrackerPageData(
    storeSession.storeId,
    todayUtc.toISOString(),
  );

  return (
    <div className="p-8">
      <PriceTrackerClient
        initialSummary={data.summary}
        initialHistory={data.history}
        initialTrackedProducts={data.trackedProducts}
        pendingCount={data.pendingCount}
        failedProducts={data.failedProducts}
        lowStockProducts={data.lowStockProducts}
      />
    </div>
  );
}
