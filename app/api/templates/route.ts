import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.descriptionTemplate.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(templates);
}

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

  const { name, content, isDefault } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // If this template is being set as default, clear all others first
  if (isDefault) {
    await prisma.descriptionTemplate.updateMany({
      data: { isDefault: false },
    });
  }

  const template = await prisma.descriptionTemplate.create({
    data: {
      name: name.trim(),
      content: content || "",
      isDefault: !!isDefault,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
