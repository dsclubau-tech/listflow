import { redirect } from "next/navigation";
import EbayResearchClient from "@/components/EbayResearchClient";
import {
  getCurrentEbayResearchBatches,
  getEbayResearchJobForStore,
  getRecentEbayResearchJobs,
} from "@/lib/ebay-research";
import { getCurrentStoreSession } from "@/lib/store-session";

export const runtime = "nodejs";

export default async function EbayResearchPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const [recentJobs, batches] = await Promise.all([
    getRecentEbayResearchJobs(storeSession.storeId),
    getCurrentEbayResearchBatches(storeSession.storeId),
  ]);
  const firstJob = recentJobs[0]
    ? await getEbayResearchJobForStore(recentJobs[0].id, storeSession.storeId)
    : null;
  const jobs = firstJob
    ? [firstJob, ...recentJobs.filter((job) => job.id !== firstJob.id)]
    : recentJobs;

  return (
    <div className="p-8">
      <EbayResearchClient initialJobs={jobs} initialBatches={batches} />
    </div>
  );
}
