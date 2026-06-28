import { redirect } from "next/navigation";
import EbayResearchClient from "@/components/EbayResearchClient";
import {
  getCurrentEbayResearchBatches,
  getEbayResearchJobForStore,
  getRecentEbayResearchJobs,
} from "@/lib/ebay-research";
import { logger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

function getResearchLoadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Research history is temporarily unavailable.";
}

export default async function EbayResearchPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  let jobs: Awaited<ReturnType<typeof getRecentEbayResearchJobs>> = [];
  let batches: Awaited<ReturnType<typeof getCurrentEbayResearchBatches>> = [];
  let initialError: string | null = null;

  try {
    const recentJobs = await getRecentEbayResearchJobs(storeSession.storeId);
    const firstJob = recentJobs[0]
      ? await getEbayResearchJobForStore(recentJobs[0].id, storeSession.storeId)
      : null;

    jobs = firstJob
      ? [firstJob, ...recentJobs.filter((job) => job.id !== firstJob.id)]
      : recentJobs;
  } catch (error) {
    initialError = getResearchLoadErrorMessage(error);
    logger.error(
      "ebay-research/page",
      "Failed to load recent eBay research jobs",
      error,
      { storeId: storeSession.storeId }
    );
  }

  try {
    batches = await getCurrentEbayResearchBatches(storeSession.storeId);
  } catch (error) {
    initialError = initialError ?? getResearchLoadErrorMessage(error);
    logger.error(
      "ebay-research/page",
      "Failed to load current eBay research batches",
      error,
      { storeId: storeSession.storeId }
    );
  }

  return (
    <div className="p-8">
      <EbayResearchClient
        initialJobs={jobs}
        initialBatches={batches}
        initialError={initialError}
      />
    </div>
  );
}
