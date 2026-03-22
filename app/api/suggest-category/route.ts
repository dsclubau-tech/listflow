import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getEbaySuggestedCategories } from "@/lib/ebay";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, storeNumber } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const validStores = [1, 2, 3];
  const store = validStores.includes(storeNumber) ? (storeNumber as 1 | 2 | 3) : 1;

  const suggestions = await getEbaySuggestedCategories(title.trim(), store);

  return NextResponse.json(suggestions);
}
