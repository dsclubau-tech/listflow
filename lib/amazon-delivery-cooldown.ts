import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import type { Prisma } from "@/app/generated/prisma/client";

export const DELIVERY_PROBE_RESOURCE = "amazon-delivery-probe";
export const deliveryCooldownSeconds = (failures: number) => [60, 120, 300, 900][Math.min(3, Math.max(0, failures - 1))];
export const DELIVERY_WAIT_REASON = "Amazon delivery setup unavailable. Remaining products preserved.";
export type DeliveryWait = { retryAt: string; waitReason: string; technicalFailureCode?: string };
export type DeliveryPermit = { storeId: string; token?: string; wait?: DeliveryWait };

const wait = (date: Date): DeliveryWait => ({ retryAt: date.toISOString(), waitReason: DELIVERY_WAIT_REASON });

/** PostgreSQL returns void from this lock; cast it so Prisma's adapter can deserialize it. */
export async function lockPriceCheckStore(tx: Pick<Prisma.TransactionClient, "$queryRaw">, storeId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`listflow-price-check:${storeId}`}))::text`;
}

/** The advisory lock is shared with both item-scheduler claim paths. */
export async function acquireDeliveryPermit(storeId: string, jobId: string, budgetMs: number): Promise<DeliveryPermit> {
  return prisma.$transaction(async tx => {
    await lockPriceCheckStore(tx, storeId);
    const now = new Date();
    const state = await tx.priceCheckScheduleState.upsert({ where: { storeId }, create: { storeId }, update: {} });
    if (state.amazonBlockedUntil && state.amazonBlockedUntil > now) return { storeId, wait: wait(state.amazonBlockedUntil) };
    if (!state.consecutivePostcodeFailures) return { storeId };
    const existing = await tx.jobLease.findUnique({ where: { storeId_resourceKey: { storeId, resourceKey: DELIVERY_PROBE_RESOURCE } } });
    if (existing && existing.expiresAt > now) return { storeId, wait: wait(existing.expiresAt) };
    const token = randomUUID();
    const data = { jobId, jobType: "AMAZON_DELIVERY_PROBE", workerId: token, workerName: "Delivery recovery probe",
      acquiredAt: now, renewedAt: now, expiresAt: new Date(now.getTime() + budgetMs + 60_000) };
    await tx.jobLease.upsert({ where: { storeId_resourceKey: { storeId, resourceKey: DELIVERY_PROBE_RESOURCE } },
      create: { storeId, resourceKey: DELIVERY_PROBE_RESOURCE, ...data }, update: data });
    return { storeId, token };
  });
}

export async function releaseDeliveryPermit(permit: DeliveryPermit) {
  if (permit.token) await prisma.jobLease.deleteMany({ where: {
    storeId: permit.storeId, resourceKey: DELIVERY_PROBE_RESOURCE, workerId: permit.token } });
}

export async function deferAmazonDelivery(permit: DeliveryPermit, technicalFailureCode: string): Promise<DeliveryWait> {
  return prisma.$transaction(async tx => {
    await lockPriceCheckStore(tx, permit.storeId);
    const now = new Date();
    const state = await tx.priceCheckScheduleState.upsert({ where: { storeId: permit.storeId },
      create: { storeId: permit.storeId }, update: {} });
    if (permit.token && !(await tx.jobLease.findFirst({ where: { storeId: permit.storeId,
      resourceKey: DELIVERY_PROBE_RESOURCE, workerId: permit.token, expiresAt: { gt: now } } }))) {
      throw new Error("Amazon delivery probe ownership expired.");
    }
    // Concurrent failures from checks already in flight share the existing window.
    if (state.amazonBlockedUntil && state.amazonBlockedUntil > now) return { ...wait(state.amazonBlockedUntil), technicalFailureCode };
    const failures = state.consecutivePostcodeFailures + 1;
    const seconds = deliveryCooldownSeconds(failures);
    const retryAt = new Date(now.getTime() + seconds * 1000);
    await tx.priceCheckScheduleState.update({ where: { storeId: permit.storeId }, data: {
      consecutivePostcodeFailures: failures, amazonCooldownSeconds: seconds, amazonBlockedUntil: retryAt } });
    return { ...wait(retryAt), technicalFailureCode };
  });
}

export async function confirmAmazonDelivery(permit: DeliveryPermit) {
  await prisma.$transaction(async tx => {
    await lockPriceCheckStore(tx, permit.storeId);
    // A probe that lost ownership cannot clear a newer worker's cooldown.
    if (permit.token && !(await tx.jobLease.findFirst({ where: { storeId: permit.storeId,
      resourceKey: DELIVERY_PROBE_RESOURCE, workerId: permit.token, expiresAt: { gt: new Date() } } }))) {
      throw new Error("Amazon delivery probe ownership expired.");
    }
    await tx.priceCheckScheduleState.updateMany({ where: { storeId: permit.storeId }, data: {
      consecutivePostcodeFailures: 0, amazonCooldownSeconds: 0, amazonBlockedUntil: null } });
  });
}

export async function getAmazonDeliveryWait(storeId: string): Promise<DeliveryWait | null> {
  const state = await prisma.priceCheckScheduleState.findUnique({ where: { storeId } });
  if (!state?.consecutivePostcodeFailures) return null;
  const probe = await prisma.jobLease.findUnique({ where: { storeId_resourceKey: { storeId, resourceKey: DELIVERY_PROBE_RESOURCE } } });
  return wait(state.amazonBlockedUntil && state.amazonBlockedUntil > new Date()
    ? state.amazonBlockedUntil : probe && probe.expiresAt > new Date() ? probe.expiresAt : new Date());
}

export function serializeDeliveryDeferral(code?: string) {
  return `[${code ?? "AMAZON_DELIVERY_POSTCODE_UNVERIFIED"}] ${DELIVERY_WAIT_REASON}`;
}
export function deliveryFailureCode(message: string | null) {
  return message?.match(/^\[(AMAZON_DELIVERY_[A-Z_]+)\]/)?.[1] ?? undefined;
}
