import { auth } from "@/auth";
import { getEbayCategoryAspects, getStoreNumber } from "@/lib/ebay";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId")?.trim() ?? "";

  if (!/^\d+$/.test(categoryId)) {
    return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
  }

  const storeNumber = await getStoreNumber(storeSession.storeId);
  const aspects = await getEbayCategoryAspects(categoryId, storeNumber);

  return NextResponse.json({
    aspects,
    requiredItemSpecifics: aspects
      .filter((aspect) => aspect.required)
      .map((aspect) => ({
        name: aspect.name,
        values: aspect.values,
        inputType: aspect.inputType,
      })),
  });
}
