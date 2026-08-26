import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";

type PolicyTemplateBody = {
  name?: unknown;
  storeId?: unknown;
  shippingPolicyId?: unknown;
  returnPolicyId?: unknown;
  paymentPolicyId?: unknown;
  descriptionTemplateId?: unknown;
  isDefault?: unknown;
};

function normalizeOptionalPolicyId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: PolicyTemplateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.policyTemplate.findUnique({
    where: { id },
    select: { id: true, storeId: true, isDefault: true },
  });

  if (!existing || existing.storeId !== storeSession.storeId) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const nextStoreId = existing.storeId;
  const nextIsDefault =
    body.isDefault === undefined ? existing.isDefault : body.isDefault === true;

  if (typeof body.storeId === "string") {
    const requestedStoreId = body.storeId.trim();

    if (requestedStoreId && requestedStoreId !== storeSession.storeId) {
      return NextResponse.json({ error: "Store not found" }, { status: 400 });
    }
  }

  if (nextIsDefault) {
    await prisma.policyTemplate.updateMany({
      where: {
        storeId: nextStoreId,
        NOT: { id },
      },
      data: { isDefault: false },
    });
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    data.name = name;
  }

  if (body.storeId !== undefined) {
    data.storeId = nextStoreId;
  }

  if (body.shippingPolicyId !== undefined) {
    data.shippingPolicyId = normalizeOptionalPolicyId(body.shippingPolicyId);
  }

  if (body.returnPolicyId !== undefined) {
    data.returnPolicyId = normalizeOptionalPolicyId(body.returnPolicyId);
  }

  if (body.paymentPolicyId !== undefined) {
    data.paymentPolicyId = normalizeOptionalPolicyId(body.paymentPolicyId);
  }

  if (body.descriptionTemplateId !== undefined) {
    const descriptionTemplateId = normalizeOptionalPolicyId(
      body.descriptionTemplateId,
    );

    if (descriptionTemplateId) {
      const descriptionTemplate = await prisma.descriptionTemplate.findFirst({
        where: {
          id: descriptionTemplateId,
          storeId: storeSession.storeId,
        },
        select: { id: true },
      });

      if (!descriptionTemplate) {
        return NextResponse.json(
          { error: "Description template not found" },
          { status: 400 },
        );
      }
    }

    data.descriptionTemplateId = descriptionTemplateId;
  }

  if (body.isDefault !== undefined) {
    data.isDefault = body.isDefault === true;
  }

  const updated = await prisma.policyTemplate.update({
    where: { id },
    data,
    include: {
      store: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.policyTemplate.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  });

  if (!existing || existing.storeId !== storeSession.storeId) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await prisma.policyTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
