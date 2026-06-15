import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.descriptionTemplate.findFirst({
    where: { id, storeId: storeSession.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // If setting as default, clear all others first
  if (body.isDefault) {
    await prisma.descriptionTemplate.updateMany({
      where: { storeId: storeSession.storeId },
      data: { isDefault: false },
    });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.content !== undefined) data.content = body.content;
  if (body.isDefault !== undefined) data.isDefault = body.isDefault;

  const updated = await prisma.descriptionTemplate.update({
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
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Check that this isn't the last template
  const count = await prisma.descriptionTemplate.count({
    where: { storeId: storeSession.storeId },
  });
  if (count <= 1) {
    return NextResponse.json(
      { error: "You must have at least one template" },
      { status: 400 }
    );
  }

  const existing = await prisma.descriptionTemplate.findFirst({
    where: { id, storeId: storeSession.storeId },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await prisma.descriptionTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
