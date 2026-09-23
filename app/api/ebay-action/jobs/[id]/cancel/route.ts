import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cancelEbayActionJob } from "@/lib/ebay-action-cancellation";
import { getCurrentStoreSession } from "@/lib/store-session";
import { invalidateJobCaches } from "@/lib/cache-tags";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user?.id || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await cancelEbayActionJob(id, storeSession.storeId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  invalidateJobCaches(storeSession.storeId);
  return NextResponse.json({ job: { id: job.id, status: job.status } });
}
