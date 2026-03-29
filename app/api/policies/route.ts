import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getEbayBusinessPolicies, getStoreNumber } from "@/lib/ebay";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const session = await auth();
  const log = createRequestLogger(request, session?.user ? { userId: session.user.id } : {});

  if (!session?.user) {
    log.warn("policies/route", "Unauthorized policies request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeParam = searchParams.get("store");

  if (!storeParam) {
    log.warn("policies/route", "Policies request missing store parameter");
    return NextResponse.json(
      { error: "store query parameter is required" },
      { status: 400 },
    );
  }

  let storeNumber: 1 | 2 | 3;

  if (["1", "2", "3"].includes(storeParam)) {
    storeNumber = parseInt(storeParam, 10) as 1 | 2 | 3;
  } else {
    try {
      storeNumber = await getStoreNumber(storeParam);
    } catch {
      log.warn("policies/route", "Invalid store supplied for policies request", {
        storeParam,
      });
      return NextResponse.json({ error: "Invalid store" }, { status: 400 });
    }
  }

  try {
    log.info("policies/route", "Fetching business policies", { storeNumber });
    const policies = await getEbayBusinessPolicies(storeNumber);
    return NextResponse.json(policies);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch policies";
    log.error("policies/route", "Failed to fetch business policies", error, {
      storeNumber,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
