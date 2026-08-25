import { auth } from "@/auth";
import {
  getCachedProductsSelectionData,
  normalizeProductsQuery,
  type SearchParamValue,
} from "@/lib/products-page-data";
import { getCurrentStoreSession } from "@/lib/store-session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = Object.fromEntries(
    new URL(request.url).searchParams.entries(),
  ) as Record<string, SearchParamValue>;

  try {
    const data = await getCachedProductsSelectionData(
      storeSession.storeId,
      normalizeProductsQuery(params),
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("[products/selection] Failed to load selection data", error);
    return NextResponse.json(
      { error: "Unable to select all listings. Please try again." },
      { status: 500 },
    );
  }
}
