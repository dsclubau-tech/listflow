import { auth } from "@/auth";
import { createEbayImportJob } from "@/lib/ebay-import-jobs";
import { resolveEbayImportStore } from "@/lib/ebay-import-store";
import { createRequestLogger } from "@/lib/logger";
import { NextResponse } from "next/server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(request: Request) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("ebay-import/jobs/POST", "Unauthorized eBay import job attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    log.error("ebay-import/jobs/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId =
    body && typeof body === "object" && "storeId" in body
      ? String((body as { storeId?: unknown }).storeId ?? "").trim()
      : "";
  const quantity =
    body && typeof body === "object" && "quantity" in body
      ? Number((body as { quantity?: unknown }).quantity)
      : 0;

  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: "quantity must be at least 1" },
      { status: 400 },
    );
  }

  try {
    const context = await resolveEbayImportStore(storeId);
    const result = await createEbayImportJob({
      userId: session.user.id,
      storeId,
      storeNumber: context.storeNumber,
      quantity,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("ebay-import/jobs/POST", "Failed to start eBay import job", error, {
      storeId,
    });
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
