import "server-only";

import { prisma } from "@/lib/prisma";

export interface PolicyIds {
  shippingPolicyId: string | null;
  returnPolicyId: string | null;
  paymentPolicyId: string | null;
}

export interface ResolvedPolicyDefaults extends PolicyIds {
  policyTemplateId: string | null;
}

type PolicyTemplateRecord = {
  id: string;
  storeId: string;
  shippingPolicyId: string | null;
  returnPolicyId: string | null;
  paymentPolicyId: string | null;
};

function normalizePolicyId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasAnyPolicyId(policyIds: PolicyIds) {
  return Boolean(
    policyIds.shippingPolicyId ||
      policyIds.returnPolicyId ||
      policyIds.paymentPolicyId,
  );
}

export function policyIdsMatch(a: PolicyIds, b: PolicyIds) {
  return (
    (a.shippingPolicyId ?? null) === (b.shippingPolicyId ?? null) &&
    (a.returnPolicyId ?? null) === (b.returnPolicyId ?? null) &&
    (a.paymentPolicyId ?? null) === (b.paymentPolicyId ?? null)
  );
}

export function normalizePolicyIds(policyIds: Partial<Record<keyof PolicyIds, unknown>>): PolicyIds {
  return {
    shippingPolicyId: normalizePolicyId(policyIds.shippingPolicyId),
    returnPolicyId: normalizePolicyId(policyIds.returnPolicyId),
    paymentPolicyId: normalizePolicyId(policyIds.paymentPolicyId),
  };
}

export async function findMatchingPolicyTemplateId(
  storeId: string,
  policyIds: PolicyIds,
) {
  if (!hasAnyPolicyId(policyIds)) {
    return null;
  }

  const template = await prisma.policyTemplate.findFirst({
    where: {
      storeId,
      shippingPolicyId: policyIds.shippingPolicyId,
      returnPolicyId: policyIds.returnPolicyId,
      paymentPolicyId: policyIds.paymentPolicyId,
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true },
  });

  return template?.id ?? null;
}

export async function getStorePolicyDefaults(
  storeId: string,
): Promise<ResolvedPolicyDefaults> {
  const [defaultTemplate, supplierSettings] = await Promise.all([
    prisma.policyTemplate.findFirst({
      where: { storeId, isDefault: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        shippingPolicyId: true,
        returnPolicyId: true,
        paymentPolicyId: true,
      },
    }),
    prisma.supplierSettings.findFirst({
      where: { storeId, supplierName: "Amazon AU" },
      select: {
        defaultShippingPolicyId: true,
        defaultReturnPolicyId: true,
        defaultPaymentPolicyId: true,
      },
    }),
  ]);

  const fallbackPolicyIds = normalizePolicyIds({
    shippingPolicyId: supplierSettings?.defaultShippingPolicyId,
    returnPolicyId: supplierSettings?.defaultReturnPolicyId,
    paymentPolicyId: supplierSettings?.defaultPaymentPolicyId,
  });

  const resolvedPolicyIds = defaultTemplate
    ? normalizePolicyIds({
        shippingPolicyId:
          defaultTemplate.shippingPolicyId ?? fallbackPolicyIds.shippingPolicyId,
        returnPolicyId:
          defaultTemplate.returnPolicyId ?? fallbackPolicyIds.returnPolicyId,
        paymentPolicyId:
          defaultTemplate.paymentPolicyId ?? fallbackPolicyIds.paymentPolicyId,
      })
    : fallbackPolicyIds;

  if (!hasAnyPolicyId(resolvedPolicyIds)) {
    return { ...resolvedPolicyIds, policyTemplateId: null };
  }

  const defaultTemplateMatches =
    defaultTemplate && policyIdsMatch(defaultTemplate, resolvedPolicyIds);

  return {
    ...resolvedPolicyIds,
    policyTemplateId: defaultTemplateMatches
      ? defaultTemplate.id
      : await findMatchingPolicyTemplateId(storeId, resolvedPolicyIds),
  };
}

export async function resolveProductPolicySelection(
  storeId: string,
  policyIds: Partial<Record<keyof PolicyIds, unknown>>,
  policyTemplateId?: unknown,
): Promise<ResolvedPolicyDefaults> {
  if (
    policyTemplateId !== undefined &&
    policyTemplateId !== null &&
    typeof policyTemplateId !== "string"
  ) {
    throw new Error("policyTemplateId must be a string or null");
  }

  const normalizedPolicyTemplateId =
    typeof policyTemplateId === "string" && policyTemplateId.trim()
      ? policyTemplateId.trim()
      : null;
  let selectedTemplate: PolicyTemplateRecord | null = null;

  if (normalizedPolicyTemplateId) {
    selectedTemplate = await prisma.policyTemplate.findUnique({
      where: { id: normalizedPolicyTemplateId },
      select: {
        id: true,
        storeId: true,
        shippingPolicyId: true,
        returnPolicyId: true,
        paymentPolicyId: true,
      },
    });

    if (!selectedTemplate || selectedTemplate.storeId !== storeId) {
      throw new Error("Policy template not found");
    }
  }

  const defaults = await getStorePolicyDefaults(storeId);
  const submittedPolicyIds = normalizePolicyIds(policyIds);
  const resolvedPolicyIds = normalizePolicyIds({
    shippingPolicyId:
      submittedPolicyIds.shippingPolicyId ??
      selectedTemplate?.shippingPolicyId ??
      defaults.shippingPolicyId,
    returnPolicyId:
      submittedPolicyIds.returnPolicyId ??
      selectedTemplate?.returnPolicyId ??
      defaults.returnPolicyId,
    paymentPolicyId:
      submittedPolicyIds.paymentPolicyId ??
      selectedTemplate?.paymentPolicyId ??
      defaults.paymentPolicyId,
  });

  if (!hasAnyPolicyId(resolvedPolicyIds)) {
    return { ...resolvedPolicyIds, policyTemplateId: null };
  }

  if (selectedTemplate && policyIdsMatch(selectedTemplate, resolvedPolicyIds)) {
    return { ...resolvedPolicyIds, policyTemplateId: selectedTemplate.id };
  }

  return {
    ...resolvedPolicyIds,
    policyTemplateId: await findMatchingPolicyTemplateId(storeId, resolvedPolicyIds),
  };
}
