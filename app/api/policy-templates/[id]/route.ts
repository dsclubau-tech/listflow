import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

type PolicyTemplateBody = {
  name?: unknown;
  storeId?: unknown;
  shippingPolicyId?: unknown;
  returnPolicyId?: unknown;
  paymentPolicyId?: unknown;
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
  if (!session?.user) {
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

  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const nextStoreId =
    typeof body.storeId === "string" && body.storeId.trim()
      ? body.storeId.trim()
      : existing.storeId;
  const nextIsDefault =
    body.isDefault === undefined ? existing.isDefault : body.isDefault === true;

  if (typeof body.storeId === "string") {
    const store = await prisma.store.findUnique({
      where: { id: nextStoreId },
      select: { id: true },
    });

    if (!store) {
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
    if (!nextStoreId) {
      return NextResponse.json({ error: "Store is required" }, { status: 400 });
    }
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
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.policyTemplate.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await prisma.policyTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
