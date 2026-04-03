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

function normalizePolicyTemplateBody(body: PolicyTemplateBody) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";

  return {
    name,
    storeId,
    shippingPolicyId:
      typeof body.shippingPolicyId === "string" && body.shippingPolicyId.trim()
        ? body.shippingPolicyId.trim()
        : null,
    returnPolicyId:
      typeof body.returnPolicyId === "string" && body.returnPolicyId.trim()
        ? body.returnPolicyId.trim()
        : null,
    paymentPolicyId:
      typeof body.paymentPolicyId === "string" && body.paymentPolicyId.trim()
        ? body.paymentPolicyId.trim()
        : null,
    isDefault: body.isDefault === true,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim();

  const templates = await prisma.policyTemplate.findMany({
    where: storeId ? { storeId } : undefined,
    include: {
      store: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ store: { name: "asc" } }, { name: "asc" }],
  });

  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PolicyTemplateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizePolicyTemplateBody(body);

  if (!normalized.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (!normalized.storeId) {
    return NextResponse.json({ error: "Store is required" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: normalized.storeId },
    select: { id: true },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 400 });
  }

  if (normalized.isDefault) {
    await prisma.policyTemplate.updateMany({
      where: { storeId: normalized.storeId },
      data: { isDefault: false },
    });
  }

  const template = await prisma.policyTemplate.create({
    data: normalized,
    include: {
      store: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return NextResponse.json(template, { status: 201 });
}
