import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { normalizeBuiltinDescriptionTemplate } from "@/lib/builtin-description-templates";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.descriptionTemplate.findMany({
    orderBy: { createdAt: "asc" },
  });

  const normalizedTemplates = templates.map((template) => {
    const normalized = normalizeBuiltinDescriptionTemplate(template);
    return normalized;
  });

  const updates = templates
    .map((template, index) => ({
      original: template,
      normalized: normalizedTemplates[index],
    }))
    .filter(({ original, normalized }) => normalized.content !== original.content)
    .map(({ original, normalized }) =>
      prisma.descriptionTemplate.update({
        where: { id: original.id },
        data: { content: normalized.content },
      }),
    );

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return NextResponse.json(normalizedTemplates);
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
