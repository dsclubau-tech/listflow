import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getEbayBusinessPolicies, getStoreNumber } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeParam = searchParams.get("store");

  if (!storeParam) {
    return NextResponse.json({ error: "store query parameter is required" }, { status: 400 });
  }

  let storeNumber: 1 | 2 | 3;

  // Accept store number directly (1/2/3) or store ID (cuid)
  if (["1", "2", "3"].includes(storeParam)) {
    storeNumber = parseInt(storeParam) as 1 | 2 | 3;
  } else {
    // Assume it's a store ID — resolve to store number
    try {
      storeNumber = await getStoreNumber(storeParam);
    } catch {
      return NextResponse.json({ error: "Invalid store" }, { status: 400 });
    }
  }

  try {
    logger.info("policies/route", "Fetching business policies", { storeNumber });
    const policies = await getEbayBusinessPolicies(storeNumber);
    return NextResponse.json(policies);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch policies";
    logger.error("policies/route", "Failed to fetch business policies", err, { storeNumber });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
