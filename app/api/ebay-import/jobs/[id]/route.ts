import { auth } from "@/auth";
import { getEbayImportJobForUser } from "@/lib/ebay-import-jobs";
import { createRequestLogger } from "@/lib/logger";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await params;
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("ebay-import/jobs/[id]/GET", "Unauthorized import job request", { id });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await getEbayImportJobForUser(id, session.user.id);

  if (!job) {
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
