import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EbayActionJobType } from "@/app/generated/prisma/enums";
import { serializeEbayActionJob } from "@/lib/ebay-action-jobs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const { id } = await params;

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.ebayActionJob.findFirst({
    where: {
      id,
      storeId: storeSession.storeId,
      type: EbayActionJobType.MANAGE_PROMOTED_ADS,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Promotion job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: serializeEbayActionJob(job) });
}
