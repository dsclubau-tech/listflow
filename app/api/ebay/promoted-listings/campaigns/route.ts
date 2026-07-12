import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getEbayGeneralCampaignOptions,
  getEbayPromotedListingsEligibility,
  getStoreNumber,
} from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {},
  );

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const storeNumber = await getStoreNumber(storeSession.storeId);
    const [campaigns, eligibility] = await Promise.all([
      getEbayGeneralCampaignOptions(storeNumber),
      getEbayPromotedListingsEligibility(storeNumber),
    ]);

    return NextResponse.json({ campaigns, eligibility });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load eBay campaigns.";
    log.error(
      "ebay/promoted-listings/campaigns",
      "Failed to load promoted listing campaigns",
      error,
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
