import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.keywordBlacklist.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (body.keyword !== undefined) data.keyword = body.keyword;
  if (body.removeFromTitle !== undefined) data.removeFromTitle = body.removeFromTitle;
  if (body.removeFromDescription !== undefined) data.removeFromDescription = body.removeFromDescription;

  const updated = await prisma.keywordBlacklist.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await prisma.keywordBlacklist.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
