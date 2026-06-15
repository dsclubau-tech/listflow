import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getEbaySuggestedCategories, getStoreNumber } from "@/lib/ebay";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const store = await getStoreNumber(storeSession.storeId);

  const suggestions = await getEbaySuggestedCategories(title.trim(), store);

  return NextResponse.json(suggestions);
}
