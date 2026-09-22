import { ListingOperationStage } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getListingOperationRequestKey } from "@/lib/listing-operation-key";

export async function recordListingOperation(input: {
  jobId: string;
  productId: string;
  storeId: string;
  stage: ListingOperationStage;
  holdGeneration?: number | null;
  expectedProductUpdatedAt?: Date | null;
  targetPrices?: unknown;
  targetQuantities?: unknown;
  preparedPayload?: unknown;
  error?: string | null;
  confirmed?: boolean;
}) {
  const now = new Date();
  const completed = input.stage === ListingOperationStage.COMPLETED;
  return prisma.listingOperation.upsert({
    where: { requestKey: getListingOperationRequestKey(input.jobId, input.productId) },
    create: {
      productId: input.productId,
      storeId: input.storeId,
      jobId: input.jobId,
      requestKey: getListingOperationRequestKey(input.jobId, input.productId),
      stage: input.stage,
      holdGeneration: input.holdGeneration ?? null,
      expectedProductUpdatedAt: input.expectedProductUpdatedAt ?? null,
      targetPrices: (input.targetPrices ?? {}) as Prisma.InputJsonValue,
      targetQuantities: (input.targetQuantities ?? {}) as Prisma.InputJsonValue,
      preparedPayload: (input.preparedPayload ?? {}) as Prisma.InputJsonValue,
      attempts: 1,
      lastError: input.error ?? null,
      ebayConfirmedAt: input.confirmed ? now : null,
      completedAt: completed ? now : null,
    },
    update: {
      stage: input.stage,
      lastError: input.error ?? null,
      attempts: { increment: 1 },
      ebayConfirmedAt: input.confirmed ? now : undefined,
      completedAt: completed ? now : undefined,
    },
  });
}
