import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { auth } from "@/auth";
import { getCurrentEbayActionJobs } from "@/lib/ebay-action-jobs";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = (await getCurrentEbayActionJobs(storeSession.storeId)).filter(
    (job) => job.type === EbayActionJobType.UPLOAD_LISTING,
  );

  return NextResponse.json({ jobs });
}
