import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keywords = await prisma.keywordBlacklist.findMany({
    where: { storeId: storeSession.storeId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(keywords);
}

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

  const { keyword, removeFromTitle, removeFromDescription } = body;

  if (!keyword?.trim()) {
    return NextResponse.json({ error: "Keyword is required" }, { status: 400 });
  }

  if (!removeFromTitle && !removeFromDescription) {
    return NextResponse.json(
      { error: "At least one action must be selected" },
      { status: 400 }
    );
  }

  const entry = await prisma.keywordBlacklist.create({
    data: {
      storeId: storeSession.storeId,
      keyword: keyword.trim(),
      removeFromTitle: !!removeFromTitle,
      removeFromDescription: !!removeFromDescription,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}
